/* ============================================
   FoxiMed — Voice Commands
   ============================================
   The "brain" of the voice assistant: turns a transcript (from speech or
   from the text fallback input) into a recognized command + parameters,
   then drives the existing calculator/tools UI exactly the way a manual
   tap would.

   This file depends on globals defined in script.js (switchTab,
   calculateBMI, AppState, DOM, drugDatabase, toggleAccordionById, ...)
   and reports results back through window.VoiceUI (showResult/appendTip),
   so it must load AFTER script.js. It can load before or after voice-ui.js
   (results are only displayed once the user actually issues a command, by
   which point every script has already loaded).

   Public API: window.VoiceCommands.process(text)
               window.VoiceCommands.getGrammar() — see VOSK GRAMMAR below

   © Mohammad Mahdi Taghavi — FoxiMed
   ============================================ */
(function (window) {
    'use strict';

    let lastCommand = null;
    let lastParams = null;

    function showVoiceResult(message, type) {
        if (window.VoiceUI && typeof window.VoiceUI.showResult === 'function') {
            window.VoiceUI.showResult(message, type || 'success');
        }
    }

    // ============================================
    // CONTEXTUAL TIPS (shown after a successful command)
    // ============================================
    const TIPS = {
        bmi: '💡 همچنین می‌توانید BSA (سطح بدن) را با گفتن «BSA وزن ۷۰ قد ۱۷۰» محاسبه کنید.',
        bsa: '💡 برای BMI بگویید «BMI وزن ۷۵ قد ۱۷۵».',
        crcl: '💡 می‌توانید جنسیت را هم مشخص کنید: «زن» یا «مرد».',
        drip: '💡 نوع ست را هم می‌توانید بگویید: «ماکروست» یا «میکروست».',
        convert: '💡 عناصر پشتیبانی‌شده: سدیم، پتاسیم، کلسیم، منیزیم، بی‌کربنات.',
        drug: '💡 می‌توانید روش تزریق، حجم محلول، تعداد آمپول و مقدار دلخواه را هم مشخص کنید.',
        gcs: '💡 برای RASS بگویید «RASS 2» یا «RASS منفی ۳».',
        rass: '💡 برای GCS بگویید «GCS 4 5 6».',
        braden: '💡 مقیاس برادن ۶ بخش دارد: حس، رطوبت، فعالیت، تحرک، تغذیه، اصطکاک.',
        morse: '💡 مقیاس مورس ۶ بخش دارد: سابقه سقوط، تشخیص ثانویه، وسیله کمکی، IV، راه رفتن، وضعیت ذهنی.',
        burns: '💡 روی نواحی سوختگی در تصویر کلیک کنید — بزرگسال یا کودک را انتخاب کنید.',
        oxygen: '💡 فرمول: حجم کپسول (لیتر) × فشار (بار) × ۰.۹ ÷ جریان (L/min) = مدت (دقیقه).',
        vbg: '💡 برای VBG می‌توانید Na، Cl و آلبومین را هم برای آنیون گپ وارد کنید.',
        ventilator: '💡 همچنین می‌توانید از طول اولنا برای تخمین قد استفاده کنید.',
        nutrition: '💡 ضریب استرس را می‌توانید با گفتن «سپسیس» یا «سوختگی» تنظیم کنید.',
        ysite: '💡 دو دارو را با هم در یک جمله بگویید تا سازگاری Y-Site بررسی شود.'
    };

    // ============================================
    // BILINGUAL ELECTROLYTE TERMS
    // (previously English-only — Persian element names like "سدیم" never
    // matched, so a fully Persian command silently failed)
    // ============================================
    const ELECTROLYTE_TERMS = {
        sodium: ['sodium', 'سدیم'],
        potassium: ['potassium', 'پتاسیم'],
        calcium: ['calcium', 'کلسیم'],
        magnesium: ['magnesium', 'منیزیم'],
        sodium_bicarbonate: ['bicarbonate', 'sodium bicarbonate', 'بی کربنات', 'بی‌کربنات', 'بیکربنات']
    };

    function matchElectrolyte(text) {
        const lower = text.toLowerCase();
        for (const key in ELECTROLYTE_TERMS) {
            const terms = ELECTROLYTE_TERMS[key];
            for (let i = 0; i < terms.length; i++) {
                if (lower.includes(terms[i])) return key;
            }
        }
        return null;
    }

    // ============================================
    // ROBUST TWO-DRUG DETECTION (for Y-Site)
    // The previous implementation matched two drugs with the regex
    // /(\w+)\s+(?:and|و)\s+(\w+)/, but `\w` only matches ASCII letters —
    // it can never match Persian script, so it silently failed for any
    // Persian sentence (i.e. almost every real voice command). This scans
    // the whole phrase for known drug names directly instead.
    // ============================================
    function findAllDrugNames(text, limit) {
        limit = limit || 2;
        const lower = text.toLowerCase();
        const found = [];
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName, drug.englishName].concat(drug.alternativeNames || []);
            let bestIndex = -1;
            for (let i = 0; i < names.length; i++) {
                const idx = lower.indexOf(String(names[i]).toLowerCase());
                if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) bestIndex = idx;
            }
            if (bestIndex !== -1) found.push({ id: id, index: bestIndex });
        }
        found.sort(function (a, b) { return a.index - b.index; });
        const ids = [];
        for (let i = 0; i < found.length; i++) {
            if (ids.indexOf(found[i].id) === -1) ids.push(found[i].id);
            if (ids.length >= limit) break;
        }
        return ids;
    }

    // ============================================
    // PARAM EXTRACTION
    // ============================================
    function extractParams(text) {
        const params = {};

        const rangeMatch = text.match(/(?:between|از)\s*(\d+(?:\.\d+)?)\s*(?:and|تا)\s*(\d+(?:\.\d+)?)/i);
        if (rangeMatch) {
            params.rangeMin = parseFloat(rangeMatch[1]);
            params.rangeMax = parseFloat(rangeMatch[2]);
        }

        if (text.includes('not using') || text.includes('بدون') || text.includes('غیرفعال')) {
            params.negated = true;
        }

        const timeMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr|ساعت|h)/i);
        if (timeMatch) params.time = parseFloat(timeMatch[1]);
        const freqMatch = text.match(/q(\d+)(h|hr)/i);
        if (freqMatch) params.frequency = parseInt(freqMatch[1]);

        const concMatch = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)\s+(?:in|در)\s+(\d+(?:\.\d+)?)\s*(ml|mL|cc)/i);
        if (concMatch) {
            params.concAmount = parseFloat(concMatch[1]);
            params.concUnit = concMatch[2];
            params.concVolume = parseFloat(concMatch[3]);
            params.concVolUnit = concMatch[4];
        }

        const weightPatterns = [
            /(?:وزن|وزنش|وزن بیمار|weight)\s*(\d+(?:\.\d+)?)\s*(?:kg|کیلوگرم|کیلو)?/i,
            /(\d+(?:\.\d+)?)\s*(?:kg|کیلوگرم|کیلو)(?:\s*وزن)?/i,
            /weight\s*(\d+(?:\.\d+)?)\s*(?:kg)?/i
        ];
        for (let i = 0; i < weightPatterns.length; i++) {
            const match = text.match(weightPatterns[i]);
            if (match) {
                params.weight = parseFloat(match[1]);
                text = text.replace(match[0], '');
                break;
            }
        }
        if (!params.weight) {
            const weightFallback = text.match(/وزن\s*(\d+(?:\.\d+)?)/i);
            if (weightFallback) params.weight = parseFloat(weightFallback[1]);
        }

        const heightPatterns = [
            /(?:قد|قدش|قد بیمار|height)\s*(\d+(?:\.\d+)?)\s*(?:cm|سانتی‌متر|سانت)?/i,
            /(\d+(?:\.\d+)?)\s*(?:cm|سانتی‌متر|سانت)(?:\s*قد)?/i,
            /height\s*(\d+(?:\.\d+)?)\s*(?:cm)?/i
        ];
        for (let i = 0; i < heightPatterns.length; i++) {
            const match = text.match(heightPatterns[i]);
            if (match) {
                params.height = parseFloat(match[1]);
                text = text.replace(match[0], '');
                break;
            }
        }
        if (!params.height) {
            const heightFallback = text.match(/قد\s*(\d+(?:\.\d+)?)/i);
            if (heightFallback) params.height = parseFloat(heightFallback[1]);
        }

        const patterns = [
            { regex: /(\d+(?:\.\d+)?)\s*(yr|سال|age)/i, key: 'age' },
            { regex: /(\d+(?:\.\d+)?)\s*(ml|mL|cc|سی‌سی)/i, key: 'volume' },
            { regex: /(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)/i, key: 'dose' },
            { regex: /(\d+(?:\.\d+)?)\s*(meq|mEq)/i, key: 'meq' },
            { regex: /(\d+(?:\.\d+)?)\s*(bar|psi|mmhg|cmh2o|kpa)/i, key: 'pressure' },
            { regex: /(\d+(?:\.\d+)?)\s*(L|litre|لیتر)/i, key: 'liters' },
            { regex: /(\d+(?:\.\d+)?)\s*(%|percent|درصد)/i, key: 'percent' },
            { regex: /(\d+(?:\.\d+)?)\s*(eye|چشمی)\s*(\d+)/i, key: 'gcs_eye' },
            { regex: /(\d+(?:\.\d+)?)\s*(verbal|کلامی)\s*(\d+)/i, key: 'gcs_verbal' },
            { regex: /(\d+(?:\.\d+)?)\s*(motor|حرکتی)\s*(\d+)/i, key: 'gcs_motor' }
        ];
        patterns.forEach(function (p) {
            const match = text.match(p.regex);
            if (match) {
                if (p.key.indexOf('gcs_') === 0) {
                    params[p.key] = parseInt(match[2] || match[1]);
                } else {
                    params[p.key] = parseFloat(match[1]);
                    text = text.replace(match[0], '');
                }
            }
        });

        if (!params.dose) {
            const anyNumber = text.match(/(\d+(?:\.\d+)?)/);
            if (anyNumber) params.dose = parseFloat(anyNumber[1]);
        }

        if (!params.gcs_eye && !params.gcs_verbal && !params.gcs_motor) {
            const gcsNums = text.match(/(?:gcs|گلاسکو)\s*(\d+)\s*(\d+)\s*(\d+)/i);
            if (gcsNums) {
                params.gcs_eye = parseInt(gcsNums[1]);
                params.gcs_verbal = parseInt(gcsNums[2]);
                params.gcs_motor = parseInt(gcsNums[3]);
            }
        }

        if (text.includes('male') || text.includes('مرد')) params.gender = 'male';
        else if (text.includes('female') || text.includes('زن')) params.gender = 'female';

        const drugId = findDrugName(text);
        if (drugId) params.drugId = drugId;

        if (text.includes('ns') || text.includes('سالین')) params.solution = 'N.S';
        else if (text.includes('d5w') || text.includes('دکستروز')) params.solution = 'D5W';

        if (text.includes('سرنگ')) params.method = 'syringe';
        else if (text.includes('انفوزیون') || text.includes('پمپ')) params.method = 'infusion';

        const ampMatch = text.match(/آمپول\s*(\d+)/i);
        if (ampMatch) params.ampoules = parseInt(ampMatch[1]);

        const customMatch = text.match(/(دلخواه|مقدار)\s*(\d+(?:\.\d+)?)\s*(units|mg|mcg|g)/i);
        if (customMatch) {
            params.customAmount = parseFloat(customMatch[2]);
            params.customUnit = customMatch[3].toLowerCase();
        }

        const flowMatch = text.match(/(\d+(?:\.\d+)?)\s*(L\/min|litre\/min|لیتر در دقیقه)/i);
        if (flowMatch) params.flow = parseFloat(flowMatch[1]);

        const electrolyte = matchElectrolyte(text);
        if (electrolyte) params.electrolyte = electrolyte;

        const twoDrugs = findAllDrugNames(text, 2);
        if (twoDrugs.length === 2) {
            params.drug1 = twoDrugs[0];
            params.drug2 = twoDrugs[1];
        }

        const rassMatch = text.match(/rass\s*([+-]?\d+)/i) || text.match(/ریچموند\s*([+-]?\d+)/i);
        if (rassMatch) params.rassScore = parseInt(rassMatch[1]);

        const bradenMatch = text.match(/برادن\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)/i);
        if (bradenMatch) params.bradenScores = bradenMatch.slice(1, 7).map(Number);

        const morseMatch = text.match(/مورس\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)/i);
        if (morseMatch) params.morseScores = morseMatch.slice(1, 7).map(Number);

        params._original = text;
        return params;
    }

    // ============================================
    // COMMAND KEYWORDS + SCORING
    // ============================================
    const COMMAND_KEYWORDS = {
        tab_calculator: { triggers: ['ماشین حساب', 'calculator tab', 'go to calculator', 'ماشین‌حساب'], scoreWeight: 0.7 },
        tab_drugs: { triggers: ['مرجع داروها', 'کتابخانه دارو', 'لیست داروها', 'داروخانه', 'drug library', 'drugs tab', 'رفتن به داروها'], scoreWeight: 0.7 },
        tab_tools: { triggers: ['ابزارها', 'تب ابزار', 'ابزارهای بالینی', 'tools tab', 'رفتن به ابزارها', 'ابزارک‌ها'], scoreWeight: 0.7 },

        clear: { triggers: ['پاک کن', 'پاک کردن', 'صفر', 'clear results', 'reset', 'پاکسازی', 'حذف نتایج'], scoreWeight: 0.8 },
        manual_calc: { triggers: [' دستی', 'دستی', 'manual calculation', 'custom calculation', ' بدون دارو', ' دلخواه'], scoreWeight: 0.9 },
        history: { triggers: ['تاریخچه', 'محاسبات قبلی', 'سابقه محاسبات', 'تاریخچه محاسبات', 'history', 'گزارش محاسبات'], scoreWeight: 0.9 },
        reverse: { triggers: ['reverse', 'معکوس', 'برعکس', 'وارونه', 'حالت معکوس'], scoreWeight: 0.9 },

        bmi: { triggers: ['bmi', 'بی ام آی', 'b.m.i', 'شاخص توده', 'body mass index', 'توده بدنی', 'وزن و قد'], scoreWeight: 0.9 },
        bsa: { triggers: ['bsa', 'بی اس ای', 'b.s.a', 'سطح بدن', 'body surface area', 'mosteller', 'dubois', 'haycock', 'مساحت بدن'], scoreWeight: 0.9 },
        ibw: { triggers: ['وزن ایده‌آل', 'ideal weight', 'ibw', 'وزن ایده‌ال', 'وزن مناسب', 'وزن استاندارد'], scoreWeight: 0.9 },
        crcl: { triggers: ['crcl', 'creatinine clearance', 'کلیرانس کراتینین', 'کراتینین', 'کلیرانس', 'clearance', 'نارسایی کلیه'], scoreWeight: 0.9 },
        drip: { triggers: ['drip', 'قطره', 'سرعت قطره', 'gravity', 'ساعت', 'حجم', 'زمان', 'ست', 'میکروست', 'ماکروست', 'قطره در دقیقه'], scoreWeight: 0.9 },
        gcs: { triggers: ['gcs', 'گلاسکو', 'glasgow', 'coma', 'کما', 'eye', 'verbal', 'motor', 'چشمی', 'کلامی', 'حرکتی', 'امتیاز هوشیاری'], scoreWeight: 0.8 },
        rass: { triggers: ['rass', 'ریچموند', 'richmond', 'agitation', 'sedation', 'آرام‌بخشی', 'آژیتیشن', 'آرام', 'بی‌قرار', 'مقیاس آرام‌بخشی'], scoreWeight: 0.8 },
        braden: { triggers: ['braden', 'برادن', 'pressure ulcer', 'زخم فشاری', 'sensory', 'moisture', 'activity', 'mobility', 'nutrition', 'friction', 'حس', 'رطوبت', 'فعالیت', 'تحرک', 'تغذیه', 'اصطکاک', 'زخم بستر'], scoreWeight: 0.8 },
        morse: { triggers: ['morse', 'مورس', 'fall', 'سقوط', 'history', 'diagnosis', 'aid', 'gait', 'mental', 'افتادن', 'تشخیص', 'وسیله', 'راه رفتن', 'ذهنی', 'خطر سقوط'], scoreWeight: 0.8 },
        burns: { triggers: ['burns', 'سوختگی', 'tbsa', 'fire', 'آتش', 'پارکلند', 'parkland', 'قانون نُه', 'rule of nines', 'سطح سوختگی', 'سوختگی پوست'], scoreWeight: 0.8 },
        oxygen: { triggers: ['oxygen', 'اکسیژن', 'کپسول', 'cylinder', 'flow', 'فشار', 'pressure', 'duration', 'مدت', 'جریان', 'اکسیژن درمانی', 'کپسول اکسیژن'], scoreWeight: 0.8 },
        vbg: { triggers: ['vbg', 'abg', 'گاز خون', 'blood gas', 'ph', 'pco2', 'hco3', 'base excess', 'be', 'bicarbonate', 'بی‌کربنات', 'گازهای خون', 'تفسیر گاز خون', 'اسید باز'], scoreWeight: 0.8 },
        ventilator: { triggers: ['ventilator', 'ونتیلاتور', 'tidal volume', 'حجم جاری', 'pbw', 'ards', 'lung protective', 'تهویه', 'حجم تنفسی', 'دستگاه تنفس'], scoreWeight: 0.8 },
        nutrition: { triggers: ['nutrition', 'تغذیه', 'کالری', 'calories', 'protein', 'پروتئین', 'bmr', 'harris', 'mifflin', 'استرس', 'stress', 'نیاز کالری', 'تغذیه انترال'], scoreWeight: 0.8 },

        convert: { triggers: ['convert', 'تبدیل', 'meq', 'to', 'به', 'میلی‌اکی‌والان', 'الکترولیت', 'تبدیل واحد'], scoreWeight: 0.9 },
        electrolyte: { triggers: ['الکترولیت', 'تبدیل الکترولیت', 'meq به mg', 'mg به meq', 'سدیم', 'پتاسیم', 'کلسیم', 'منیزیم', 'بی‌کربنات', 'electrolyte'], scoreWeight: 0.9 },
        percentage: { triggers: ['درصد', 'غلظت درصد', 'percentage solution', 'محلول درصدی', 'درصد دارو'], scoreWeight: 0.9 },
        unit_convert: { triggers: ['تبدیل واحد', 'واحد', 'میکروگرم', 'میلی‌گرم', 'گرم', 'unit conversion', 'مبدل واحد'], scoreWeight: 0.9 },
        temp_convert: { triggers: ['تبدیل دما', 'درجه', 'سلسیوس', 'فارنهایت', 'temperature', 'دمای بدن', 'تب'], scoreWeight: 0.9 },
        weight_convert: { triggers: ['تبدیل وزن', 'کیلوگرم', 'پوند', 'گرم', 'weight conversion', 'وزن به پوند', 'وزن به کیلو'], scoreWeight: 0.9 },

        drug: { triggers: ['دارو', 'دوز', 'انفوزیون', 'تزریق', 'پمپ', 'سرنگ', 'میکروگرم', 'میلی‌گرم', 'واحد', 'kg/h', 'mcg', 'mg', 'units', 'میلی‌لیتر', 'سی‌سی', 'حجم', 'محلول', 'آمپول', 'ویال', 'دوز دارو'], scoreWeight: 1.0 },
        druginfo: { triggers: ['اطلاعات', 'درباره', 'توضیح', 'شرح', 'کاربرد', 'مقدار مصرف', 'نحوه مصرف', 'چیه', 'چیست', 'info', 'about', 'describe', 'معرفی', 'راهنما دارو'], scoreWeight: 0.9 },
        dose_calc: { triggers: [' دوز', 'دوز دارو', 'حجم ویال', 'dose calculation', 'vial', 'حجم تزریقی', 'مقدار مصرف دارو'], scoreWeight: 0.9 },
        compat_tool: { triggers: ['سازگاری دارو', 'compatibility', 'تداخل دارویی', 'داروها', 'drug compatibility', 'سازگاری y-site', 'y-site', 'مخلوط داروها'], scoreWeight: 0.9 },
        ysite: { triggers: ['ysite', 'y-site', 'سازگاری', 'تداخل', 'دارو', 'mix', 'مخلوط', 'همزمان', 'تزریق همزمان', 'y-site compatibility'], scoreWeight: 0.8 },

        settings: { triggers: ['dark mode', 'light mode', 'تاریک', 'روشن', 'دارک', 'لایت', 'large font', 'small font', 'فونت بزرگ', 'فونت کوچک', 'تم تاریک', 'تم روشن', 'تنظیمات', 'settings', 'حالت شب', 'حالت روز'], scoreWeight: 0.7 },
        theme: { triggers: ['فاکس', 'fox', 'روباه', 'اقیانوس', 'ocean', 'رز', 'rose', 'جنگل', 'forest', 'پیش‌فرض', 'default', 'تم فاکس', 'تم اقیانوس', 'تم رز', 'تم جنگل', 'theme fox', 'theme ocean', 'theme rose', 'theme forest', 'هدو', 'سایرن', 'لینکس', 'ویکسن'], scoreWeight: 0.9 },

        help: { triggers: ['help', 'راهنما', 'کمک', 'راهنمایی', 'نمونه', 'example', 'چه کارایی', 'چطور کار کنم', 'راهنمای صوتی', 'چه کار کنم'], scoreWeight: 0.6 }
    };

    function scoreCommand(text, params) {
        const lower = text.toLowerCase();
        const scores = {};
        for (const cmd in COMMAND_KEYWORDS) {
            const info = COMMAND_KEYWORDS[cmd];
            let score = 0;
            for (let i = 0; i < info.triggers.length; i++) {
                if (lower.includes(info.triggers[i])) score += 1;
            }
            if (cmd === 'drug' && params.drugId) score += 2;
            if (cmd === 'druginfo' && params.drugId) score += 2;
            if (cmd === 'bmi' && params.weight && params.height) score += 2;
            if (cmd === 'bsa' && params.weight && params.height) score += 2;
            if (cmd === 'crcl' && params.age && params.weight && params.dose) score += 2;
            if (cmd === 'drip' && params.volume && params.time) score += 2;
            if (cmd === 'convert' && params.meq && params.electrolyte) score += 2;
            if (cmd === 'gcs' && (params.gcs_eye || params.gcs_verbal || params.gcs_motor)) score += 2;
            if (cmd === 'rass' && params.rassScore !== undefined) score += 2;
            if (cmd === 'braden' && params.bradenScores) score += 2;
            if (cmd === 'morse' && params.morseScores) score += 2;
            if (cmd === 'burns' && text.includes('سوختگی')) score += 2;
            if (cmd === 'oxygen' && (params.flow || params.pressure || params.liters)) score += 2;
            if (cmd === 'ventilator' && (params.height || params.weight)) score += 2;
            if (cmd === 'nutrition' && (params.weight || params.height || params.age)) score += 2;
            if (cmd === 'ysite' && (params.drug1 || params.drug2)) score += 2;
            if (cmd === 'settings' && (text.includes('dark') || text.includes('light') || text.includes('font') || text.includes('تاریک') || text.includes('روشن') || text.includes('دارک') || text.includes('لایت'))) score += 2;
            scores[cmd] = score * info.scoreWeight;
        }
        return scores;
    }

    const FAST_COMMANDS = {
        'تاریک': function () { AppState.settings.themeMode = 'dark'; saveSettings(); applyThemeMode(); showVoiceResult('حالت تاریک فعال شد', 'success'); },
        'روشن': function () { AppState.settings.themeMode = 'light'; saveSettings(); applyThemeMode(); showVoiceResult('حالت روشن فعال شد', 'success'); },
        'فونت بزرگ': function () { AppState.settings.largeFont = true; saveSettings(); applySettings(); showVoiceResult('فونت بزرگ فعال شد', 'success'); },
        'فونت معمولی': function () { AppState.settings.largeFont = false; saveSettings(); applySettings(); showVoiceResult('فونت معمولی فعال شد', 'success'); },
        'راهنما': function () { showVoiceResult('دستورات نمونه: «هپارین ۱۲ واحد/کیلوگرم/ساعت وزن ۷۰»، «BMI وزن ۷۵ قد ۱۷۵»، «قطره ۵۰۰ میلی‌لیتر در ۸ ساعت»، «تاریک»، «فونت بزرگ»', 'info'); },
        'ماشین حساب': function () { switchTab('calculator'); showVoiceResult('بخش ماشین حساب باز شد', 'success'); },
        'داروها': function () { switchTab('drugs'); showVoiceResult('مرجع داروها باز شد', 'success'); },
        'ابزارها': function () { switchTab('tools'); showVoiceResult('ابزارهای بالینی باز شد', 'success'); }
    };

    const PERSIAN_NUMBER_WORDS = {
        'یک': '1', 'دو': '2', 'سه': '3', 'چهار': '4', 'پنج': '5',
        'شش': '6', 'هفت': '7', 'هشت': '8', 'نه': '9', 'ده': '10',
        'یازده': '11', 'دوازده': '12', 'سیزده': '13', 'چهارده': '14', 'پانزده': '15',
        'شانزده': '16', 'هفده': '17', 'هجده': '18', 'نوزده': '19', 'بیست': '20',
        'سی': '30', 'چهل': '40', 'پنجاه': '50', 'شصت': '60', 'هفتاد': '70', 'هشتاد': '80', 'نود': '90', 'صد': '100',
        'دویست': '200', 'سیصد': '300', 'چهارصد': '400', 'پانصد': '500',
        'ششصد': '600', 'هفتصد': '700', 'هشتصد': '800', 'نهصد': '900', 'هزار': '1000'
    };
    // Longest words first — critical so a compound word like "نهصد" (900)
    // is matched whole before its own prefix "نه" (9) ever gets a chance
    // to (previously: extractDoseFromText's substring-based fallback could
    // match "نه" *inside* "نهصد" and silently return 9 instead of 900).
    const PERSIAN_NUMBER_WORD_KEYS = Object.keys(PERSIAN_NUMBER_WORDS).sort(function (a, b) { return b.length - a.length; });
    // Matches a number word only when it's a standalone token (preceded and
    // followed by whitespace/string edges) — `\b` does NOT work for this
    // since it's defined in terms of ASCII word characters and never fires
    // around Persian script at all.
    function matchPersianNumberWord(text, word) {
        return new RegExp('(^|\\s)' + word + '(?=$|\\s)').test(text);
    }

    const PERSIAN_UNIT_WORDS = {
        'میلی گرم': 'mg', 'میلی‌گرم': 'mg',
        'میکرو گرم': 'mcg', 'میکروگرم': 'mcg',
        'گرم': 'g', 'واحد': 'units'
    };

    // ============================================
    // SMALL TALK (nurses' downtime chat)
    // A lighthearted, warm layer so the assistant doesn't feel purely
    // transactional. Deliberately scoped tight: only fires on short
    // messages with no drug name and no digits, so it can never hijack a
    // real clinical command (extended from an earlier draft of this app).
    // Order matters — more specific phrases are listed before broad,
    // generic ones like plain confirmations ("باشه"/"خوب").
    // ============================================
    const SMALL_TALK = {
        // greetings
        'سلام|درود|هلو|hi|hello|hey|sup': [
            'سلام! وقت بخیر 🌸 چطور می‌تونم کمکت کنم؟',
            'درود بر شما! خوشحالم که اینجایی ✨',
            'سلام! امیدوارم روز خوبی داشته باشی ☀️',
            'هی! چه خبر؟ آماده‌ام کمکت کنم 😊',
            'سلام دوست من! خوش اومدی 🌼'
        ],
        'صبح بخیر|صبحت بخیر|صبح شما بخیر': [
            'صبح شما هم بخیر ☀️ شیفت خوبی داشته باشی',
            'صبح بخیر! امیدوارم امروز روز آرومی باشه 🌅',
            'سلام صبح بخیر! یه قهوه و آماده‌ای برای شروع ☕'
        ],
        'شب بخیر|شبت بخیر|شب شما بخیر': [
            'شب بخیر 🌙 شیفت شب رو با قدرت ادامه بده',
            'شب شما هم بخیر! مراقب خودت باش 💫',
            'شب بخیر! اگه خواب آلودی، یه استراحت کوتاه بگیر اگه میشه 😴'
        ],
        // identity / about the app
        'کی تورو ساخت|کی ساخته|سازنده|کی نوشته|برنامه نویس|برنامه‌نویس': [
            'من رو یکی از همکارات ساخته! 🦊 ولی تویی که بیمارا رو نجات می‌دی، قهرمان اصلی‌ای ✨',
            'برنامه‌نویسم یکی از همکاراته که کارش رو دوست داره. گفته کمک به پرستارا یعنی کمک به بیمارا 💖',
            'سازنده‌م یه پرستاره و گفته هرجوری شده باید تو کارت کمکت کنم 📱'
        ],
        'اسمت چیه|اسمت چیست|تو کی هستی|معرفی کن خودتو|خودتو معرفی کن': [
            'من دستیار صوتی فاکسی‌مد هستم 🦊 اینجام تا محاسبات رو سریع‌تر کنم',
            'بهم میگن فاکسی! دستیار صوتی این برنامه‌ام، در خدمتتم 🦊',
            'یه دستیار کوچیکم که قراره کارای محاسباتی رو برات راحت کنه ✨'
        ],
        // nurse life — tiredness / shift difficulty
        'خسته‌ام|خستم|خستگی': [
            'آره شیفتا واقعاً خسته‌کننده‌ان... یه نفس عمیق بکش و یادت باشه آب کافی بخوری 💧',
            'میدونم، این شغل خیلی انرژی می‌بره. ولی تو قوی‌ای، از پسش برمیای 💪',
            'خسته نباشی! اگه فرصت شد چند دقیقه چشماتو ببند، بهتر میشی 🍵'
        ],
        'شیفت بد|شیفت سخته|شیفت سخت': [
            'آره بعضی شیفتا واقعاً طاقت‌فرساست. ولی تو از پسش برمیای 💪',
            'شیفت سخت بگذره، یادت باشه بعدش یه دوش گرم و یه خواب خوب همه چیزو بهتر می‌کنه 🌙',
            'شیفتت شاید سخت باشه، اما با حضورت روز رو برا بقیه بهتر می‌کنی ✨'
        ],
        'تموم نمیشه|کی تموم میشه|چرا تموم نمیشه': [
            'آره بعضی وقتا انگار زمان متوقف شده... صبور باش، تموم میشه ☕',
            'نگران نباش، همه‌چیز بالاخره تموم میشه 🌟',
            'نفس عمیق بکش، یکی‌یکی پیش برو. تو از پسش برمیای 🧘'
        ],
        'شلوغه|شلوغ|پرکاره|پرکار': [
            'شلوغی یعنی بهت نیاز بیشتری هست. تو می‌تونی، چون بهترینی 💪',
            'نفس عمیق بکش، اولویت‌بندی کن و یکی‌یکی پیش ببر 🧘',
            'تو این شلوغی، اول از همه مراقب خودت باش 🧘'
        ],
        'پاهام درد|کمردرد|درد میکنه|کمرم درد': [
            'میفهمم، خیلی سخته طولانی سرپا بودن. کفش مناسب و استراحت بین شیفتا رو جدی بگیر 🦶',
            'درد پا یا کمر یعنی باید بیشتر به خودت برسی. یه کشش ساده هم میتونه کمک کنه 🧘',
            'کفش طبی و چند دقیقه نشستن واقعاً فرق میکنه 👟'
        ],
        'خوابم میاد|چقدر خوابم میاد|شیفت شب سخته': [
            'شیفت شب همیشه سخت‌تره... یه چای کمرنگ و چند قدم راه رفتن کمک می‌کنه 🌙',
            'میدونم سخته بیدار ماندن. اگه فرصت شد یه استراحت کوتاه بگیر ☕',
            'شب‌ها سخت‌تره ولی صبح نزدیکه! یکم دیگه دوام بیار 💪'
        ],
        'گشنمه|تشنمه|گرسنمه': [
            'اگه فرصت شد یه چیز کوچیک بخور و آب فراموش نشه 💧',
            'یادت نره بین کارها یه لحظه برای خودت هم وقت بگذاری 🍎',
            'هر وقت توانستی یه استراحت کوتاه برای غذا بگیر، حواست به خودت هم باشه 🌿'
        ],
        'استرس دارم|نگرانم|اعصابم': [
            'میفهمم، روزای سخت داریم همه. یه نفس عمیق بکش، قدم به قدم پیش برو 🧘',
            'استرس بخشی از این کاره، ولی تو خیلی بهتر از چیزی که فکر میکنی از پسش برمیای 💪',
            'اگه زیاد شد، با یکی صحبت کن. تنها نیستی 🌸'
        ],
        // gratitude / praise
        'متشکرم|ممنون|مرسی|تشکر': [
            'خواهش می‌کنم! وظیفمه ☺️',
            'قابل نداشت! هر وقت کمک خواستی، من اینجام 🌸',
            'ممنون از لطفت! امیدوارم همیشه موفق باشی ✨'
        ],
        'دستت درد نکنه|دست شما درد نکنه': [
            'دست شما هم درد نکنه! 🌸 موفق باشی',
            'ممنونم! امیدوارم بازم بتونم کمکت کنم 🤝',
            'خواهش می‌کنم! این وظیفمه که به بهترین پرستارا کمک کنم 💪'
        ],
        'ایول|آفرین|چه عالی|عالیه': [
            'ممنون! امیدوارم همیشه موفق باشی ✨',
            'آفرین به تو! تو باعث افتخاری 🌟',
            'ممنونم! این انگیزه‌ست که بهتر کار کنم 💪'
        ],
        'این اپ خوبه|عالیه این برنامه|اپ خوبیه': [
            'خیلی خوشحالم که برات مفیده! 🦊 هر پیشنهادی داشتی بگو',
            'ممنون! تلاش می‌کنیم همیشه بهتر بشه ✨',
            'خوشحالم کمک می‌کنه! بهترین قسمتش تویی که ازش استفاده می‌کنی 💖'
        ],
        // apology
        'ببخشید|شرمنده|معذرت': [
            'نیازی به ببخشید نیست! 🌸 بگو چی لازم داری',
            'مشکلی نیست، همینجام 😊',
            'خواهش میکنم، راحت باش 🌼'
        ],
        // fun
        'جوک بگو|بخندونم|یه چیز خنده‌دار بگو': [
            'یه روباه به دکتر گفت دکتر دلم درد میکنه، دکتر گفت لابد یه چیزی رو فاکسید کردی! 🦊😄',
            'تنها چیزی که این موقع شب بیشتر از قهوه بهم نیرو میده، دیدن یه شیفت بدون آلارم اضافه‌ست ☕😌',
            'اگه کدنویس‌ها هم مثل پرستارا شیفت شب میرفتن، الان نصف برنامه‌ها باگ داشت 😅'
        ],
        // farewell
        'خداحافظ|بای|فعلا|می بینمت|میرم دیگه': [
            'خداحافظ! مراقب خودت باش 🌸',
            'فعلا! هر وقت لازم شد من اینجام 👋',
            'به سلامت! شیفت خوبی داشته باشی ✨'
        ],
        // how are you (kept after the more specific entries above)
        'چطوری|خوبی|حالت چطوره|چطورید|چطورین': [
            'خوبم، ممنون! امیدوارم تو هم خوب باشی ❤️ چطور می‌تونم کمکت کنم؟',
            'عالی، چون دارم بهت کمک می‌کنم! 😊 تو چطوری؟',
            'من همیشه برای کمک بهت آماده‌ام! ☀️'
        ],
        // generic confirmations — broad and low-specificity, kept last
        'بله|اوکی|باشه|چشم|حتماً|خوبه': [
            'چشم! هر وقت آماده‌ای، بگو 📝',
            'باشه! منتظر فرمان شما هستم 🚀',
            'خوبه! هر کاری میتونم برات انجام بدم، بگو 🤝'
        ]
    };

    function hasDrugMention(lower) {
        for (const id in drugDatabase) {
            const d = drugDatabase[id];
            if (lower.includes(d.persianName.toLowerCase()) || lower.includes(d.englishName.toLowerCase())) return true;
        }
        return false;
    }

    function trySmallTalk(normalized, lower) {
        const hasNumber = /\d/.test(normalized);
        if (hasDrugMention(lower) || hasNumber || normalized.length >= 50) return false;

        for (const pattern in SMALL_TALK) {
            if (new RegExp(pattern, 'i').test(lower)) {
                const replies = SMALL_TALK[pattern];
                showVoiceResult(replies[Math.floor(Math.random() * replies.length)], 'success');
                return true;
            }
        }
        // Short, unrecognized chat-like message — still respond warmly
        // rather than a cold "didn't understand".
        if (normalized.length > 0 && normalized.length < 20) {
            const generic = [
                'مطمئنم می‌تونم کمک کنم! فقط بگو چطور 🦊',
                'هر چی بگی، گوش‌هام باهاته 👂',
                'بگو، چیکار می‌تونم برات انجام بدم؟ 😊'
            ];
            showVoiceResult(generic[Math.floor(Math.random() * generic.length)], 'success');
            return true;
        }
        return false;
    }

    // ============================================
    // VOSK GRAMMAR (experimental)
    // Vosk's small/dynamic models support an optional vocabulary list that
    // biases the decoder toward known words instead of the full language —
    // it can still freely recombine these words in any order/sequence a
    // user actually speaks them in, it's not limited to exact pre-written
    // phrases. Built once and cached; voice-recognition.js asks for this
    // only for the Vosk (iOS) backend, with a "[unk]" catch-all included
    // so genuinely unlisted speech doesn't get forced into the wrong known
    // word — and falls back to unconstrained recognition entirely if the
    // specific model build doesn't support a grammar at all.
    // ============================================
    let cachedGrammar = null;
    const EXTRA_GRAMMAR_WORDS = [
        'بمی', 'بی ام ای', 'بی', 'ام', 'ای', 'جی سی اس', 'آر اس اس',
        'وزن', 'قد', 'سن', 'مرد', 'زن', 'ساعت', 'دقیقه', 'لیتر', 'درصد',
        'mg', 'mcg', 'g', 'ml', 'meq', 'units', 'kg', 'bar', 'psi',
        'میلی گرم', 'میلی‌گرم', 'میکروگرم', 'میکرو گرم', 'گرم', 'واحد',
        'سی سی', 'سی‌سی', 'و', 'به', 'در', 'تا', 'از', 'با', 'بدون'
    ];

    function buildVoiceGrammar() {
        if (cachedGrammar) return cachedGrammar;
        const words = new Set();

        function addPhrase(phrase) {
            if (!phrase) return;
            String(phrase).trim().split(/\s+/).forEach(function (w) {
                if (w) words.add(w);
            });
        }

        // Drug names — every word of every name/alias, plus the full name
        // itself for the common single-word cases.
        for (const id in drugDatabase) {
            const d = drugDatabase[id];
            addPhrase(d.persianName);
            addPhrase(d.englishName);
            (d.alternativeNames || []).forEach(addPhrase);
        }

        // Every trigger phrase across every command, split into words.
        for (const cmd in COMMAND_KEYWORDS) {
            COMMAND_KEYWORDS[cmd].triggers.forEach(addPhrase);
        }

        // Numbers, units, small connective words.
        Object.keys(PERSIAN_NUMBER_WORDS).forEach(addPhrase);
        Object.keys(PERSIAN_UNIT_WORDS).forEach(addPhrase);
        EXTRA_GRAMMAR_WORDS.forEach(addPhrase);

        words.add('[unk]');
        cachedGrammar = JSON.stringify(Array.from(words));
        return cachedGrammar;
    }

    // ============================================
    // MAIN ENTRY POINT
    // ============================================
    function process(text) {
        let normalized = PersianNumbers.toLatin(text);
        normalized = normalized.replace(/[،،]/g, ' ').replace(/\s+/g, ' ').trim();
        const lower = normalized.toLowerCase();

        for (const key in FAST_COMMANDS) {
            if (lower === key || lower === 'برو به ' + key || lower === 'رفتن به ' + key) {
                FAST_COMMANDS[key]();
                return;
            }
        }

        if (lower.includes('dark mode') || lower.includes('دارک') || lower.includes('تاریک') || lower.includes('حالت شب')) {
            AppState.settings.themeMode = 'dark';
            saveSettings(); applyThemeMode();
            showVoiceResult('حالت تاریک فعال شد', 'success');
            return;
        }
        if (lower.includes('light mode') || lower.includes('لایت') || lower.includes('روشن') || lower.includes('حالت روز')) {
            AppState.settings.themeMode = 'light';
            saveSettings(); applyThemeMode();
            showVoiceResult('حالت روشن فعال شد', 'success');
            return;
        }
        if (lower.includes('large font') || lower.includes('فونت بزرگ')) {
            AppState.settings.largeFont = true;
            saveSettings(); applySettings();
            showVoiceResult('فونت بزرگ فعال شد', 'success');
            return;
        }
        if (lower.includes('small font') || lower.includes('فونت کوچک') || lower.includes('فونت معمولی')) {
            AppState.settings.largeFont = false;
            saveSettings(); applySettings();
            showVoiceResult('فونت معمولی فعال شد', 'success');
            return;
        }

        // --- Small talk (checked before drug/number parsing so it never
        // hijacks a real clinical command — only fires on short, numberless,
        // drug-free phrases) ---
        if (trySmallTalk(normalized, lower)) return;

        let textWithDigits = normalized;
        for (let i = 0; i < PERSIAN_NUMBER_WORD_KEYS.length; i++) {
            const word = PERSIAN_NUMBER_WORD_KEYS[i];
            textWithDigits = textWithDigits.replace(
                new RegExp('(^|\\s)' + word + '(?=$|\\s)', 'g'),
                function (match, prefix) { return prefix + PERSIAN_NUMBER_WORDS[word]; }
            );
        }
        for (const persian in PERSIAN_UNIT_WORDS) {
            textWithDigits = textWithDigits.replace(new RegExp(persian, 'g'), PERSIAN_UNIT_WORDS[persian]);
        }

        const params = extractParams(textWithDigits);

        const infoTriggers = ['اطلاعات', 'درباره', 'توضیح', 'شرح', 'کاربرد', 'مقدار مصرف', 'نحوه مصرف', 'چیه', 'چیست', 'info', 'about', 'describe'];
        let hasInfoTrigger = false;
        for (let i = 0; i < infoTriggers.length; i++) { if (lower.includes(infoTriggers[i])) { hasInfoTrigger = true; break; } }
        if (hasInfoTrigger) {
            const drugId = params.drugId || findDrugName(normalized);
            if (drugId) { executeCommand('druginfo', normalized, { drugId: drugId }); return; }
        }

        if ((lower.includes('سطح بدن') || lower.includes('body surface')) && params.weight && params.height) {
            executeCommand('bsa', normalized, params);
            return;
        }

        if ((lower.includes('no') || lower.includes('نه') || lower.includes('اشتباه')) && lastCommand) {
            showVoiceResult('دستور قبلی لغو شد. لطفاً دوباره بگویید.', 'info');
            lastCommand = null;
            lastParams = null;
            return;
        }

        const scores = scoreCommand(normalized, params);
        const sorted = Object.entries(scores).sort(function (a, b) { return b[1] - a[1]; });
        const best = sorted[0];

        if (!best || best[1] === 0) {
            if (params.weight && params.height) { executeCommand('bmi', normalized, params); return; }
            showVoiceResult('متوجه نشدم. لطفاً واضح‌تر بگویید یا از دکمه‌های نمونه استفاده کنید.', 'error');
            return;
        }

        executeCommand(best[0], normalized, params);
    }

    // ============================================
    // COMMAND EXECUTION
    // ============================================
    function executeCommand(cmd, text, params) {
        lastCommand = cmd;
        lastParams = params;

        switch (cmd) {
            case 'history':
                loadHistory();
                if (DOM.historyModal) {
                    DOM.historyModal.classList.add('active');
                    document.body.classList.add('no-scroll');
                }
                showVoiceResult('تاریخچه محاسبات باز شد', 'success');
                break;
            case 'help':
                showVoiceResult('دستورات نمونه: «هپارین ۱۲ واحد/کیلوگرم/ساعت وزن ۷۰»، «BMI وزن ۷۵ قد ۱۷۵»، «قطره ۵۰۰ میلی‌لیتر در ۸ ساعت»، «تبدیل ۲۰ mEq سدیم به mg»، «GCS 4 5 6»، «سوختگی»، «اکسیژن ۵ لیتر فشار ۱۵۰ بار جریان ۴»، «تغذیه وزن ۷۰ قد ۱۷۵ سن ۵۰»، «سازگاری هپارین و وانکومایسین»، «تاریک»، «فونت بزرگ»', 'info');
                break;
            case 'reverse':
                AppState.reverseMode = !AppState.reverseMode;
                updateReverseUI();
                showVoiceResult(AppState.reverseMode ? 'حالت معکوس فعال شد' : 'حالت معکوس غیرفعال شد', 'info');
                break;
            case 'drug': handleDrugVoice(text, params); break;
            case 'bmi': handleBMIVoice(params); break;
            case 'bsa': handleBSAVoice(params); break;
            case 'crcl': handleCrClVoice(params); break;
            case 'drip': handleDripRateVoice(params); break;
            case 'convert': handleConvertVoice(text, params); break;
            case 'gcs': handleGCSVoice(text, params); break;
            case 'rass': handleRASSVoice(text, params); break;
            case 'braden': handleBradenVoice(params); break;
            case 'morse': handleMorseVoice(params); break;
            case 'burns': handleBurnsVoice(text); break;
            case 'oxygen': handleOxygenVoice(params); break;
            case 'vbg': handleVBGVoice(text, params); break;
            case 'ventilator': handleVentilatorVoice(text, params); break;
            case 'nutrition': handleNutritionVoice(text, params); break;
            case 'ysite': handleYSiteVoice(text, params); break;
            case 'druginfo': handleDrugInfo(text, params); break;

            case 'tab_calculator':
                switchTab('calculator');
                showVoiceResult('بخش ماشین حساب باز شد', 'success');
                break;
            case 'tab_drugs':
                switchTab('drugs');
                showVoiceResult('مرجع داروها باز شد', 'success');
                break;
            case 'tab_tools':
                switchTab('tools');
                showVoiceResult('ابزارهای بالینی باز شد', 'success');
                break;
            case 'clear':
                clearResults();
                showVoiceResult('نتایج پاک شد', 'success');
                break;
            case 'manual_calc':
                switchTab('calculator');
                openManualCalculation();
                showVoiceResult('محاسبه دستی باز شد', 'success');
                break;
            case 'ibw':
                switchTab('tools');
                setTimeout(function () {
                    calculateIBW();
                    openAccordionForTool('ibwResult', 'ibwAccordionItem');
                }, 300);
                showVoiceResult('وزن ایده‌آل محاسبه شد', 'success');
                break;
            case 'electrolyte':
                switchTab('tools');
                setTimeout(function () {
                    convertElectrolyteLive('meq');
                    openAccordionForTool('electrolyteResult', 'electrolyteAccordionItem');
                }, 300);
                showVoiceResult('تبدیل الکترولیت انجام شد', 'success');
                break;
            case 'percentage':
                switchTab('tools');
                setTimeout(function () {
                    convertPercentageLive();
                    openAccordionForTool('percentageResult', 'percentageAccordionItem');
                }, 300);
                showVoiceResult('غلظت درصد محاسبه شد', 'success');
                break;
            case 'unit_convert':
                switchTab('tools');
                setTimeout(function () {
                    convertUnitsLive('from');
                    openAccordionForTool('unitResult', 'unitAccordionItem');
                }, 300);
                showVoiceResult('تبدیل واحد انجام شد', 'success');
                break;
            case 'temp_convert':
                switchTab('tools');
                setTimeout(function () {
                    convertTempLive('c');
                    openAccordionForTool('tempResult', 'tempAccordionItem');
                }, 300);
                showVoiceResult('تبدیل دما انجام شد', 'success');
                break;
            case 'weight_convert':
                switchTab('tools');
                setTimeout(function () {
                    convertWeightLive('kg');
                    openAccordionForTool('weightResult', 'weightAccordionItem');
                }, 300);
                showVoiceResult('تبدیل وزن انجام شد', 'success');
                break;
            case 'dose_calc':
                switchTab('tools');
                setTimeout(function () {
                    populateDoseCalcFromDrug();
                    calculateDose();
                }, 300);
                showVoiceResult('محاسبه دوز انجام شد', 'success');
                break;
            case 'compat_tool':
                switchTab('tools');
                setTimeout(function () { checkCompatibility(); }, 300);
                showVoiceResult('بررسی سازگاری انجام شد', 'success');
                break;
            case 'theme': {
                const themeMap = {
                    'fox': 'fox', 'فاکس': 'fox', 'روباه': 'fox',
                    'ocean': 'ocean', 'اقیانوس': 'ocean', 'سایرن': 'ocean',
                    'rose': 'rose', 'رز': 'rose', 'ویکسن': 'rose',
                    'forest': 'forest', 'جنگل': 'forest', 'لینکس': 'forest',
                    'default': 'default', 'پیش‌فرض': 'default', 'هدو': 'default'
                };
                const lowerText = text.toLowerCase();
                let foundTheme = null;
                for (const key in themeMap) {
                    if (lowerText.includes(key)) { foundTheme = themeMap[key]; break; }
                }
                if (foundTheme) {
                    AppState.settings.colorTheme = foundTheme;
                    saveSettings();
                    applyTheme(foundTheme);
                    showVoiceResult('تم ' + foundTheme + ' فعال شد', 'success');
                } else {
                    showVoiceResult('تم شناسایی نشد', 'error');
                }
                break;
            }
            default:
                showVoiceResult('این دستور هنوز پشتیبانی نمی‌شود.', 'error');
        }

        const tip = TIPS[cmd];
        if (tip && window.VoiceUI && typeof window.VoiceUI.appendTip === 'function') {
            setTimeout(function () { window.VoiceUI.appendTip(tip); }, 1500);
        }
    }

    // ============================================
    // ACCORDION HELPERS (used by the handlers below)
    // ============================================
    function openAccordionById(itemId) {
        const item = document.getElementById(itemId);
        if (!item) return;
        if (item.classList.contains('open')) return;

        document.querySelectorAll('.accordion-item.open').forEach(function (openItem) {
            if (openItem !== item) {
                openItem.classList.remove('open');
                const body = openItem.querySelector('.accordion-body');
                if (body) { body.style.maxHeight = '0'; body.style.padding = '0'; }
                const chev = openItem.querySelector('.accordion-chevron');
                if (chev) chev.style.transform = '';
            }
        });

        item.classList.add('open');
        const body = item.querySelector('.accordion-body');
        if (body) {
            body.style.maxHeight = body.scrollHeight + 2000 + 'px';
            body.style.padding = '0 0 14px';
        }
        const chevron = item.querySelector('.accordion-chevron');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
        haptic(20);
        setTimeout(function () { item.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
    }

    function openAccordionForTool(resultElementId, fallbackItemId) {
        const resultEl = document.getElementById(resultElementId);
        if (resultEl) {
            const item = resultEl.closest('.accordion-item');
            if (item) {
                const body = item.querySelector('.accordion-body');
                if (body && body.id) { toggleAccordionById(body.id); return true; }
            }
        }
        if (fallbackItemId) {
            const item = document.getElementById(fallbackItemId);
            if (item && item.classList.contains('accordion-item')) {
                const body = item.querySelector('.accordion-body');
                if (body && body.id) { toggleAccordionById(body.id); return true; }
            }
        }
        return false;
    }

    // ============================================
    // PER-TOOL HANDLERS
    // ============================================
    function handleDrugVoice(text, params) {
        const drugId = params.drugId || findDrugName(text);
        if (!drugId) {
            showVoiceResult('دارو شناسایی نشد. لطفاً نام دارو را واضح بگویید.', 'error');
            return;
        }

        selectDrug(drugId);
        const drug = drugDatabase[drugId];

        if (params.method) {
            document.querySelectorAll('.method-btn-compact').forEach(function (btn) {
                if (btn.dataset.method === params.method) btn.click();
            });
        }

        if (params.volume !== undefined) {
            const methodKey = AppState.infusionMethod;
            const volumes = drug.defaultSolutionVolumes[methodKey];
            if (volumes.includes(params.volume)) {
                const btns = document.querySelectorAll('.volume-preset-btn');
                for (let i = 0; i < btns.length; i++) {
                    if (parseInt(btns[i].dataset.volume) === params.volume) { btns[i].click(); break; }
                }
            } else if (DOM.customVolumeContainer) {
                DOM.customVolumeContainer.style.display = 'flex';
                DOM.customVolume.value = params.volume;
                DOM.customVolume.dataset.numericValue = params.volume;
                AppState.customVolume = true;
                document.querySelectorAll('.volume-preset-btn').forEach(function (b) { b.classList.remove('active'); });
            }
        }

        if (params.ampoules) {
            AppState.ampouleCount = Math.max(1, params.ampoules);
            updateAmpouleInfo();
            const ampDisplay = document.getElementById('ampouleCount');
            if (ampDisplay) ampDisplay.textContent = AppState.ampouleCount;
        }

        if (params.customAmount !== undefined && params.customUnit) {
            const isInsulin = drug.id === 'insulin';
            if (!isInsulin && DOM.customAmountToggleClickRow) DOM.customAmountToggleClickRow.click();
            if (DOM.customAmountInput) {
                DOM.customAmountInput.value = params.customAmount;
                DOM.customAmountInput.dataset.numericValue = params.customAmount;
            }
        }

        const useWeight = (params.weight !== undefined) || text.includes('/kg');
        if (useWeight && DOM.weightCheckbox && DOM.patientWeight) {
            DOM.weightCheckbox.checked = true;
            AppState.useWeight = true;
            DOM.patientWeight.disabled = false;
            if (DOM.weightIosToggle) DOM.weightIosToggle.classList.add('on');
            if (DOM.weightInputRow) DOM.weightInputRow.style.display = 'flex';
            const w = params.weight || (drug.weightBased && drug.weightBased.defaultWeight) || 70;
            DOM.patientWeight.value = w;
            DOM.patientWeight.dataset.numericValue = w;
            updateWeightBasedUnit(drug);
        } else if (DOM.weightCheckbox) {
            DOM.weightCheckbox.checked = false;
            AppState.useWeight = false;
            if (DOM.weightIosToggle) DOM.weightIosToggle.classList.remove('on');
            if (DOM.weightInputRow) DOM.weightInputRow.style.display = 'none';
            if (DOM.patientWeight) DOM.patientWeight.disabled = true;
        }

        let doseVal = params.dose || null;
        if (!doseVal || doseVal <= 0) doseVal = extractDoseFromText(text);
        if (doseVal !== null && doseVal > 0) {
            if (DOM.doctorOrder) {
                DOM.doctorOrder.value = doseVal;
                DOM.doctorOrder.dataset.numericValue = doseVal;
            }
        } else {
            showVoiceResult('دوز مشخص نشد. لطفاً مقدار دوز را بگویید.', 'error');
            return;
        }

        try {
            if (AppState.currentTab !== 'calculator') switchTab('calculator');
            updateDoseRangeIndicator();
            if (AppState.reverseMode) calculateReverse(); else calculateInfusion();
            setTimeout(function () {
                const results = document.getElementById('resultsSection');
                if (results && results.style.display === 'block') {
                    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 300);
            showVoiceResult('محاسبه ' + drug.persianName + ' با دوز ' + doseVal + ' انجام شد.', 'success');
        } catch (e) {
            showVoiceResult('خطا در محاسبه: ' + e.message, 'error');
        }
    }

    function handleDrugInfo(text, params) {
        const drugId = params.drugId || findDrugName(text);
        if (!drugId) { showVoiceResult('نام دارو مشخص نشد. لطفاً نام دارو را بگویید.', 'error'); return; }
        const drug = drugDatabase[drugId];
        if (!drug) { showVoiceResult('این دارو در پایگاه داده موجود نیست.', 'error'); return; }

        switchTab('drugs');
        setTimeout(function () {
            const drugItem = document.querySelector('.qref-accordion-item[data-drug-id="' + drugId + '"]');
            if (drugItem) {
                const header = drugItem.querySelector('.qref-row');
                if (header && header.dataset.bodyId) {
                    toggleAccordionById(header.dataset.bodyId);
                    setTimeout(function () { drugItem.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400);
                } else if (header) {
                    header.click();
                }
            } else {
                const items = document.querySelectorAll('.qref-accordion-item');
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const nameEl = item.querySelector('.qref-name');
                    if (nameEl && nameEl.textContent.includes(drug.persianName)) {
                        const header = item.querySelector('.qref-row');
                        if (header && header.dataset.bodyId) {
                            toggleAccordionById(header.dataset.bodyId);
                            setTimeout(function () { item.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400);
                        }
                        break;
                    }
                }
            }
            showVoiceResult('✅ اطلاعات ' + drug.persianName + ' در بخش مرجع داروها باز شد.', 'success');
        }, 300);
    }

    function handleBMIVoice(params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('bmiAccordionItem'); }, 300);

        const w = params.weight || 0;
        const h = params.height || 0;
        if (!w || !h) { showVoiceResult('لطفاً وزن و قد را وارد کنید (مثال: BMI وزن ۷۵ قد ۱۷۵)', 'error'); return; }
        document.getElementById('bmiWeight').value = w;
        document.getElementById('bmiHeight').value = h;
        calculateBMI();
        const result = document.getElementById('bmiResult');
        const msg = result ? 'BMI محاسبه شد: ' + (result.textContent || result.innerText) : 'BMI محاسبه شد';
        showVoiceResult(msg, 'success');
    }

    function handleBSAVoice(params) {
        const w = params.weight || 0;
        const h = params.height || 0;
        if (!w || !h) { showVoiceResult('لطفاً وزن و قد را وارد کنید (مثال: BSA وزن ۷۰ قد ۱۷۰)', 'error'); return; }
        document.getElementById('bsaWeight').value = w;
        document.getElementById('bsaHeight').value = h;
        const text = params._original || '';
        const formulaSelect = document.getElementById('bsaFormula');
        if (formulaSelect) {
            if (text.includes('mosteller')) formulaSelect.value = 'mosteller';
            else if (text.includes('dubois')) formulaSelect.value = 'dubois';
            else if (text.includes('haycock')) formulaSelect.value = 'haycock';
        }
        calculateBSA();
        showVoiceResult('BSA محاسبه شد', 'success');
        switchTab('tools');
        setTimeout(function () { openAccordionById('bsaAccordionItem'); }, 300);
    }

    function handleCrClVoice(params) {
        const age = params.age || 0;
        const w = params.weight || 0;
        const cr = params.dose || 0;
        const gender = params.gender || 'male';
        if (!age || !w || !cr) { showVoiceResult('لطفاً سن، وزن و کراتینین را وارد کنید', 'error'); return; }
        document.getElementById('crclAge').value = age;
        document.getElementById('crclWeight').value = w;
        document.getElementById('crclValue').value = cr;
        document.getElementById('crclGender').value = gender;
        calculateCrCl();
        showVoiceResult('کلیرانس کراتینین محاسبه شد', 'success');
        switchTab('tools');
        setTimeout(function () { openAccordionById('crclAccordionItem'); }, 300);
    }

    function handleDripRateVoice(params) {
        const vol = params.volume || 0;
        const time = params.time || 0;
        if (!vol || !time) { showVoiceResult('لطفاً حجم و زمان را وارد کنید (مثال: قطره ۵۰۰ میلی‌لیتر در ۸ ساعت)', 'error'); return; }
        document.getElementById('dripVolume').value = vol;
        document.getElementById('dripTime').value = time;
        calculateDripRateLive();
        showVoiceResult('نرخ قطره محاسبه شد', 'success');
        switchTab('tools');
        setTimeout(function () { openAccordionById('dripAccordionItem'); }, 300);
    }

    function handleConvertVoice(text, params) {
        // Supports both "convert 20 mEq sodium to mg" and the natural
        // Persian phrasing used in the example chip: "تبدیل ۲۰ mEq سدیم به mg".
        const match = text.match(/(?:convert|تبدیل)\s+(\d+(?:\.\d+)?)\s*(meq|mg|mcg|g)\b[^a-zA-Z\u0600-\u06FF]*(.*?)\s*(?:to|به)\s*(meq|mg|mcg|g)/i);
        const elemKey = params.electrolyte || matchElectrolyte(text);

        if (!match || !elemKey) {
            showVoiceResult('فرمت تبدیل: «تبدیل ۲۰ mEq سدیم به mg» یا «convert 20 mEq sodium to mg»', 'error');
            return;
        }
        const value = parseFloat(match[1]);
        const fromUnit = match[2].toLowerCase();
        const toUnit = match[4].toLowerCase();

        document.getElementById('electrolyteElement').value = elemKey;
        const meqEl = document.getElementById('electrolyteMeq');
        const mgEl = document.getElementById('electrolyteMg');
        if (fromUnit === 'meq' && toUnit === 'mg') {
            meqEl.value = value;
            convertElectrolyteLive('meq');
        } else if (fromUnit === 'mg' && toUnit === 'meq') {
            mgEl.value = value;
            convertElectrolyteLive('mg');
        } else {
            showVoiceResult('واحدها باید mEq و mg باشند.', 'error');
            return;
        }
        showVoiceResult('تبدیل انجام شد', 'success');
        switchTab('tools');
        setTimeout(function () { openAccordionById('electrolyteAccordionItem'); }, 300);
    }

    function handleGCSVoice(text, params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('gcsAccordionItem'); }, 300);

        let e = params.gcs_eye || 0;
        let v = params.gcs_verbal || 0;
        let m = params.gcs_motor || 0;
        if (!e || !v || !m) {
            const nums = text.match(/(\d+)\s*(\d+)\s*(\d+)/);
            if (nums) { e = parseInt(nums[1]); v = parseInt(nums[2]); m = parseInt(nums[3]); }
        }
        if (!e || !v || !m) { showVoiceResult('لطفاً سه عدد برای GCS وارد کنید (مثال: GCS 4 5 6)', 'error'); return; }

        document.querySelectorAll('.gcs-btn[data-domain="eye"]').forEach(function (btn) { if (parseInt(btn.dataset.score) === e) btn.click(); });
        document.querySelectorAll('.gcs-btn[data-domain="verbal"]').forEach(function (btn) { if (parseInt(btn.dataset.score) === v) btn.click(); });
        document.querySelectorAll('.gcs-btn[data-domain="motor"]').forEach(function (btn) { if (parseInt(btn.dataset.score) === m) btn.click(); });
        showVoiceResult('GCS محاسبه شد: E' + e + ' V' + v + ' M' + m, 'success');
    }

    function handleRASSVoice(text, params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('rassAccordionItem'); }, 300);

        let score = params.rassScore;
        if (score === undefined) {
            const match = text.match(/([+-]?\d+)/);
            if (match) score = parseInt(match[1]);
        }
        if (score === undefined || score < -5 || score > 4) {
            showVoiceResult('لطفاً عدد RASS را بین -5 تا 4 وارد کنید (مثال: RASS 2)', 'error');
            return;
        }
        document.querySelectorAll('.rass-level').forEach(function (level) { if (parseInt(level.dataset.score) === score) level.click(); });
        showVoiceResult('RASS ' + score + ' تنظیم شد', 'success');
    }

    function handleBradenVoice(params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('bradenAccordionItem'); }, 300);

        const scores = params.bradenScores;
        if (!scores || scores.length !== 6) {
            showVoiceResult('لطفاً ۶ عدد برای برادن وارد کنید (حس، رطوبت، فعالیت، تحرک، تغذیه، اصطکاک)', 'info');
            return;
        }
        const domains = ['sensory', 'moisture', 'activity', 'mobility', 'nutrition', 'friction'];
        domains.forEach(function (d, i) {
            document.querySelectorAll('.gcs-btn[data-braden="' + d + '"]').forEach(function (btn) { if (parseInt(btn.dataset.score) === scores[i]) btn.click(); });
        });
        showVoiceResult('مقیاس برادن تنظیم شد', 'success');
    }

    function handleMorseVoice(params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('morseAccordionItem'); }, 300);

        const scores = params.morseScores;
        if (!scores || scores.length !== 6) {
            showVoiceResult('لطفاً ۶ عدد برای مورس وارد کنید (سابقه سقوط، تشخیص ثانویه، وسیله کمکی، IV، راه رفتن، وضعیت ذهنی)', 'info');
            return;
        }
        const domains = ['fallHistory', 'secDiag', 'aid', 'iv', 'gait', 'mental'];
        domains.forEach(function (d, i) {
            document.querySelectorAll('.gcs-btn[data-morse="' + d + '"]').forEach(function (btn) { if (parseInt(btn.dataset.score) === scores[i]) btn.click(); });
        });
        showVoiceResult('مقیاس مورس تنظیم شد', 'success');
    }

    function handleBurnsVoice(text) {
        switchTab('tools');
        showVoiceResult('لطفاً روی نواحی سوختگی در بخش سوختگی کلیک کنید.', 'info');
        if (text.includes('کودک') || text.includes('pediatric')) setBurnsAge('pediatric');
        else setBurnsAge('adult');
        setTimeout(function () { openAccordionById('burnsAccordionItem'); }, 300);
    }

    function handleOxygenVoice(params) {
        const size = params.liters || 0;
        const pressure = params.pressure || 0;
        const flow = params.flow || 0;
        if (!size || !pressure || !flow) {
            showVoiceResult('لطفاً حجم کپسول، فشار و جریان را وارد کنید (مثال: اکسیژن ۵ لیتر فشار ۱۵۰ بار جریان ۴ لیتر در دقیقه)', 'error');
            switchTab('tools');
            return;
        }
        document.getElementById('oxyCylinderSize').value = size;
        document.getElementById('oxyPressure').value = pressure;
        document.getElementById('oxyFlow').value = flow;
        calculateOxygen();
        showVoiceResult('مدت کپسول اکسیژن محاسبه شد', 'success');
        switchTab('tools');
        setTimeout(function () {
            if (!openAccordionForTool('oxyResult', 'oxygenAccordionItem')) openAccordionById('oxygenAccordion');
        }, 300);
    }

    function handleVBGVoice(text, params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('vbgAccordionItem'); }, 300);

        const pH = params.pH || 0;
        const pco2 = params.pco2 || 0;
        const hco3 = params.hco3 || 0;
        if (!pH || !pco2 || !hco3) {
            showVoiceResult('لطفاً pH، pCO₂ و HCO₃ را وارد کنید (مثال: VBG pH 7.4 pco2 45 hco3 24)', 'error');
            return;
        }
        document.getElementById('vbgPH').value = pH;
        document.getElementById('vbgPCO2').value = pco2;
        document.getElementById('vbgHCO3').value = hco3;
        if (params.be) document.getElementById('vbgBE').value = params.be;
        interpretVBG();
        showVoiceResult('تفسیر گازهای خون انجام شد', 'success');
    }

    function handleVentilatorVoice(text, params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('ventilatorAccordionItem'); }, 300);

        const height = params.height || 0;
        const gender = params.gender || 'male';
        if (!height) { showVoiceResult('لطفاً قد بیمار را وارد کنید (مثال: ونتیلاتور قد ۱۷۵ مرد)', 'error'); return; }
        document.getElementById('ventHeight').value = height;
        document.querySelectorAll('#ventGenderBtns .method-btn-compact').forEach(function (btn) { if (btn.dataset.gender === gender) btn.click(); });
        const heightTab = document.querySelector('#ventMethodTabs .vent-tab[data-tab="height"]');
        if (heightTab) heightTab.click();
        calculateVentTV();
        showVoiceResult('حجم جاری ونتیلاتور محاسبه شد', 'success');
    }

    function handleNutritionVoice(text, params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('nutritionAccordionItem'); }, 300);

        const weight = params.weight || 0;
        const height = params.height || 0;
        const age = params.age || 0;
        const gender = params.gender || 'male';
        if (!weight || !height || !age) {
            showVoiceResult('لطفاً وزن، قد و سن را وارد کنید (مثال: تغذیه وزن ۷۰ قد ۱۷۵ سن ۵۰ مرد)', 'error');
            return;
        }
        document.getElementById('nutWeight').value = weight;
        document.getElementById('nutHeight').value = height;
        document.getElementById('nutAge').value = age;
        document.querySelectorAll('#nutGenderBtns .method-btn-compact').forEach(function (btn) { if (btn.dataset.gender === gender) btn.click(); });
        if (text.includes('سپسیس') || text.includes('sepsis')) document.getElementById('nutStress').value = '1.35';
        else if (text.includes('سوختگی')) document.getElementById('nutStress').value = '1.5';
        else if (text.includes('آردس') || text.includes('ards')) document.getElementById('nutStress').value = '2.0';
        else document.getElementById('nutStress').value = '1.2';
        calculateNutrition();
        showVoiceResult('نیاز تغذیه‌ای محاسبه شد', 'success');
    }

    function handleYSiteVoice(text, params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('ysiteAccordionItem'); }, 300);

        const ids = findAllDrugNames(text, 2);
        const d1 = params.drug1 || ids[0];
        const d2 = params.drug2 || ids[1];
        if (!d1 || !d2 || d1 === d2) {
            showVoiceResult('لطفاً دو دارو را برای بررسی سازگاری وارد کنید (مثال: سازگاری هپارین و وانکومایسین)', 'error');
            return;
        }
        document.querySelectorAll('#ysiteDrugGrid .ysite-drug-chip').forEach(function (chip) {
            if (chip.dataset.id === d1 || chip.dataset.id === d2) chip.click();
        });
        const n1 = drugDatabase[d1] ? drugDatabase[d1].persianName : d1;
        const n2 = drugDatabase[d2] ? drugDatabase[d2].persianName : d2;
        showVoiceResult('سازگاری ' + n1 + ' و ' + n2 + ' بررسی شد', 'success');
    }

    // ============================================
    // SMALL TEXT HELPERS
    // ============================================
    function findDrugName(text) {
        const lower = text.toLowerCase();
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName.toLowerCase(), drug.englishName.toLowerCase()].concat(
                (drug.alternativeNames || []).map(function (n) { return n.toLowerCase(); })
            );
            for (let i = 0; i < names.length; i++) {
                if (lower.includes(names[i])) return id;
            }
        }
        return null;
    }

    function extractDoseFromText(text) {
        if (!text) return null;
        let match = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)/i);
        if (match) return parseFloat(match[1]);
        match = text.match(/\b(\d+(?:\.\d+)?)\b/);
        if (match) return parseFloat(match[1]);
        for (let i = 0; i < PERSIAN_NUMBER_WORD_KEYS.length; i++) {
            const word = PERSIAN_NUMBER_WORD_KEYS[i];
            if (matchPersianNumberWord(text, word)) return parseFloat(PERSIAN_NUMBER_WORDS[word]);
        }
        return null;
    }

    window.VoiceCommands = { process: process, getGrammar: buildVoiceGrammar };
})(window);
