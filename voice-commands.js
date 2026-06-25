/* ============================================
   FoxiMed — Voice Commands (Enhanced + Debug)
   ============================================ */
(function (window) {
    'use strict';

    // ------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------
    let lastCommand = null;
    let lastParams = null;
    let pendingConfirmation = null;

    // ------------------------------------------------------------
    // SAFE RESULT DISPLAY (with fallback)
    // ------------------------------------------------------------
    function showVoiceResult(message, type) {
        try {
            if (window.VoiceUI && typeof window.VoiceUI.showResult === 'function') {
                window.VoiceUI.showResult(message, type || 'success');
            } else {
                // Fallback: use toast
                if (typeof showToast === 'function') {
                    showToast(type || 'info', message);
                } else {
                    alert(message);
                }
            }
        } catch (e) {
            console.error('[Voice] showVoiceResult error:', e);
        }
    }

    // ------------------------------------------------------------
    // UTILITY: Fuzzy match (Levenshtein)
    // ------------------------------------------------------------
    function levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                const cost = a[j-1] === b[i-1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i-1][j] + 1,
                    matrix[i][j-1] + 1,
                    matrix[i-1][j-1] + cost
                );
            }
        }
        return matrix[b.length][a.length];
    }

    function fuzzyMatch(text, target, threshold) {
        threshold = threshold || 2;
        const lower = text.toLowerCase();
        const targetLower = target.toLowerCase();
        if (lower.includes(targetLower)) return true;
        const words = lower.split(/\s+/);
        for (const w of words) {
            if (levenshtein(w, targetLower) <= threshold) return true;
        }
        if (levenshtein(lower, targetLower) <= threshold * 2) return true;
        return false;
    }

    // ------------------------------------------------------------
    // PERSIAN NUMBER PARSER
    // ------------------------------------------------------------
    const NUMBER_WORDS = {
        'صفر':0,'یک':1,'دو':2,'سه':3,'چهار':4,'پنج':5,
        'شش':6,'هفت':7,'هشت':8,'نه':9,'ده':10,
        'یازده':11,'دوازده':12,'سیزده':13,'چهارده':14,'پانزده':15,
        'شانزده':16,'هفده':17,'هجده':18,'نوزده':19,'بیست':20,
        'سی':30,'چهل':40,'پنجاه':50,'شصت':60,'هفتاد':70,'هشتاد':80,'نود':90,
        'صد':100,'دویست':200,'سیصد':300,'چهارصد':400,'پانصد':500,
        'ششصد':600,'هفتصد':700,'هشتصد':800,'نهصد':900,
        'هزار':1000,'میلیون':1000000
    };
    const NUMBER_KEYS = Object.keys(NUMBER_WORDS).sort((a,b)=>b.length-a.length);

    function normalizeText(text) {
        let s = text;
        // Replace common mishearings
        const phraseMap = {
            'بی ام ای':'bmi','بی ام آ':'bmi','بی ام آی':'bmi',
            'بی‌ام‌ای':'bmi','بی‌ام‌آ':'bmi','بی‌ام‌آی':'bmi',
            'بی اس ای':'bsa','بی‌اس‌ای':'bsa','سطح بدن':'bsa',
            'گلاسکو':'gcs','گلاسگو':'gcs',
            'ریچموند':'rass',
            'وی بی جی':'vbg','وی‌بی‌جی':'vbg','گاز خون':'vbg',
            'سوختگی':'burns','درصد سوختگی':'burns',
            'اکسیژن':'oxygen','کپسول':'oxygen',
            'ونتیلاتور':'ventilator','حجم جاری':'ventilator',
            'تغذیه':'nutrition',
            'میکرون':'میکرو','میلی گرم':'mg','میلی‌گرم':'mg',
            'میکرو گرم':'mcg','میکروگرم':'mcg',
            'گرم':'g','واحد':'units',
            'سی سی':'cc','سی‌سی':'cc',
            'ساعت':'hr','دقیقه':'min',
            'سی':'30','چهل':'40','پنجاه':'50','شصت':'60',
            'هفتاد':'70','هشتاد':'80','نود':'90'
        };
        for (const [phrase, replacement] of Object.entries(phraseMap)) {
            const regex = new RegExp(phrase, 'gi');
            s = s.replace(regex, replacement);
        }
        // Replace number words with digits
        for (const word of NUMBER_KEYS) {
            const regex = new RegExp('\\b' + word + '\\b', 'gi');
            s = s.replace(regex, NUMBER_WORDS[word]);
        }
        // Handle "و" addition
        let prev;
        do {
            prev = s;
            s = s.replace(/(\d+)\s*و\s*(\d+)/g, (match, a, b) => String(parseInt(a) + parseInt(b)));
        } while (s !== prev);
        return s;
    }

    // ------------------------------------------------------------
    // DRUG NAME MATCHING
    // ------------------------------------------------------------
    const DRUG_SYNONYMS = {
        'لازیس':'lasix','لازیک':'lasix','لازیکس':'lasix','فوروزماید':'lasix',
        'هپارین':'heparin','هپارین سدیم':'heparin',
        'فنتانیل':'fentanyl','فنتانیل سدیم':'fentanyl',
        'میدازولام':'midazolam','ورسید':'midazolam',
        'نوراپی نفرین':'norepinephrine','نورآدرنالین':'norepinephrine',
        'دوپامین':'dopamine','اینوتروپ':'dopamine',
        'آمیودارون':'amiodarone','کوردارون':'amiodarone',
        'پنتوپرازول':'pantoprazole','پروتونیکس':'pantoprazole',
        'لابتالول':'labetalol','تراندیت':'labetalol',
        'اکترئوتاید':'octreotide','ساندوستاتین':'octreotide',
        'نیتروگلیسیرین':'tng','تی ان جی':'tng',
        'انسولین':'insulin','سوبلیماز':'fentanyl'
    };

    function findDrugName(text) {
        const lower = text.toLowerCase();
        for (const [alias, id] of Object.entries(DRUG_SYNONYMS)) {
            if (lower.includes(alias)) return id;
        }
        if (typeof drugDatabase === 'undefined' || !drugDatabase) {
            console.warn('[Voice] drugDatabase not available');
            return null;
        }
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName.toLowerCase(), drug.englishName.toLowerCase()]
                .concat((drug.alternativeNames || []).map(n => n.toLowerCase()));
            for (const name of names) {
                if (lower.includes(name)) return id;
            }
        }
        // Fuzzy fallback
        const words = text.split(/\s+/);
        let bestId = null;
        let bestScore = Infinity;
        const threshold = 3;
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName, drug.englishName].concat(drug.alternativeNames || []);
            for (const name of names) {
                const nameLower = name.toLowerCase();
                if (nameLower.includes(' ')) {
                    const dist = levenshtein(lower, nameLower);
                    if (dist < bestScore && dist <= threshold) {
                        bestScore = dist; bestId = id;
                    }
                } else {
                    for (const word of words) {
                        if (!word) continue;
                        const dist = levenshtein(word.toLowerCase(), nameLower);
                        if (dist < bestScore && dist <= threshold) {
                            bestScore = dist; bestId = id;
                        }
                    }
                }
            }
        }
        return bestId;
    }

    function findAllDrugNames(text, limit) {
        limit = limit || 2;
        const found = [];
        const lower = text.toLowerCase();
        for (const [alias, id] of Object.entries(DRUG_SYNONYMS)) {
            if (lower.includes(alias) && !found.includes(id)) {
                found.push(id);
                if (found.length >= limit) return found;
            }
        }
        if (typeof drugDatabase === 'undefined') return found;
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName.toLowerCase(), drug.englishName.toLowerCase()]
                .concat((drug.alternativeNames || []).map(n => n.toLowerCase()));
            for (const name of names) {
                if (lower.includes(name) && !found.includes(id)) {
                    found.push(id);
                    if (found.length >= limit) return found;
                }
            }
        }
        return found;
    }

    // ------------------------------------------------------------
    // PARAMETER EXTRACTION
    // ------------------------------------------------------------
    function extractParams(text) {
        const params = {};
        const s = normalizeText(text);

        const weightPatterns = [
            /(\d+(?:\.\d+)?)\s*kg\b/i,
            /(\d+(?:\.\d+)?)\s*کیلو[^\d]*/i,
            /وزن\s*(\d+(?:\.\d+)?)/i,
            /وزنش\s*(\d+(?:\.\d+)?)/i,
        ];
        for (const p of weightPatterns) {
            const m = s.match(p);
            if (m && !params.weight) {
                params.weight = parseFloat(m[1]);
                break;
            }
        }

        const heightPatterns = [
            /(\d+(?:\.\d+)?)\s*cm\b/i,
            /(\d+(?:\.\d+)?)\s*سانت[^\d]*/i,
            /قد\s*(\d+(?:\.\d+)?)/i,
            /قدش\s*(\d+(?:\.\d+)?)/i,
        ];
        for (const p of heightPatterns) {
            const m = s.match(p);
            if (m && !params.height) {
                params.height = parseFloat(m[1]);
                break;
            }
        }

        const ageMatch = s.match(/(\d+(?:\.\d+)?)\s*(yr|سال|age)/i);
        if (ageMatch) params.age = parseFloat(ageMatch[1]);

        const doseMatch = s.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)/i);
        if (doseMatch) params.dose = parseFloat(doseMatch[1]);

        const volMatch = s.match(/(\d+(?:\.\d+)?)\s*(ml|mL|cc|سی‌سی)/i);
        if (volMatch) params.volume = parseFloat(volMatch[1]);

        const timeMatch = s.match(/(\d+(?:\.\d+)?)\s*(hour|hr|ساعت|h)/i);
        if (timeMatch) params.time = parseFloat(timeMatch[1]);

        const pressMatch = s.match(/(\d+(?:\.\d+)?)\s*(bar|psi|mmhg|cmh2o|kpa)/i);
        if (pressMatch) params.pressure = parseFloat(pressMatch[1]);

        const flowMatch = s.match(/(\d+(?:\.\d+)?)\s*(L\/min|litre\/min|لیتر در دقیقه)/i);
        if (flowMatch) params.flow = parseFloat(flowMatch[1]);

        const gcsMatch = s.match(/gcs\s*(\d+)\s*(\d+)\s*(\d+)/i);
        if (gcsMatch) {
            params.gcs_eye = parseInt(gcsMatch[1]);
            params.gcs_verbal = parseInt(gcsMatch[2]);
            params.gcs_motor = parseInt(gcsMatch[3]);
        }

        const rassMatch = s.match(/rass\s*([+-]?\d+)/i);
        if (rassMatch) params.rassScore = parseInt(rassMatch[1]);

        const phMatch = s.match(/ph\s*(\d+(?:\.\d+)?)/i);
        if (phMatch) params.pH = parseFloat(phMatch[1]);
        const pco2Match = s.match(/pco2\s*(\d+(?:\.\d+)?)/i);
        if (pco2Match) params.pco2 = parseFloat(pco2Match[1]);
        const hco3Match = s.match(/hco3\s*(\d+(?:\.\d+)?)/i);
        if (hco3Match) params.hco3 = parseFloat(hco3Match[1]);

        const elecMatch = s.match(/(سدیم|پتاسیم|کلسیم|منیزیم|بی‌کربنات|bicarbonate)/i);
        if (elecMatch) {
            const map = { 'سدیم':'sodium', 'پتاسیم':'potassium', 'کلسیم':'calcium', 'منیزیم':'magnesium', 'بی‌کربنات':'sodium_bicarbonate', 'bicarbonate':'sodium_bicarbonate' };
            params.electrolyte = map[elecMatch[1].toLowerCase()] || null;
        }

        if (s.includes('male') || s.includes('مرد')) params.gender = 'male';
        else if (s.includes('female') || s.includes('زن')) params.gender = 'female';

        const drugId = findDrugName(s);
        if (drugId) params.drugId = drugId;

        const drugIds = findAllDrugNames(s, 2);
        if (drugIds.length === 2) {
            params.drug1 = drugIds[0];
            params.drug2 = drugIds[1];
        }

        const customMatch = s.match(/(دلخواه|مقدار)\s*(\d+(?:\.\d+)?)\s*(units|mg|mcg|g)/i);
        if (customMatch) {
            params.customAmount = parseFloat(customMatch[2]);
            params.customUnit = customMatch[3].toLowerCase();
        }

        const burnPct = s.match(/(\d+(?:\.\d+)?)\s*(%|درصد)/i);
        if (burnPct) params.burnPercent = parseFloat(burnPct[1]);

        const oxySize = s.match(/(\d+(?:\.\d+)?)\s*(L|لیتر)/i);
        if (oxySize) params.liters = parseFloat(oxySize[1]);
        const oxyPressure = s.match(/(\d+(?:\.\d+)?)\s*(bar|بار)/i);
        if (oxyPressure) params.pressure = parseFloat(oxyPressure[1]);

        params._original = text;
        params._normalized = s;
        return params;
    }

    // ------------------------------------------------------------
    // COMMAND KEYWORDS
    // ------------------------------------------------------------
    const COMMANDS = {
        tab_calculator: { triggers: ['ماشین حساب', 'calculator', 'محاسبه'], scoreWeight: 0.7 },
        tab_drugs: { triggers: ['مرجع داروها', 'کتابخانه دارو', 'لیست داروها', 'داروخانه', 'drug library'], scoreWeight: 0.7 },
        tab_tools: { triggers: ['ابزارها', 'ابزار', 'tools'], scoreWeight: 0.7 },
        clear: { triggers: ['پاک کن', 'پاک کردن', 'صفر', 'clear', 'reset', 'پاکسازی'], scoreWeight: 0.8 },
        manual_calc: { triggers: ['دستی', 'manual', 'بدون دارو', 'دلخواه'], scoreWeight: 0.9 },
        history: { triggers: ['تاریخچه', 'history', 'سابقه', 'گزارش'], scoreWeight: 0.9 },
        reverse: { triggers: ['معکوس', 'reverse', 'برعکس', 'وارونه'], scoreWeight: 0.9 },
        bmi: { triggers: ['bmi', 'بی ام ای', 'بی‌ام‌ای', 'شاخص توده', 'body mass index', 'وزن و قد'], scoreWeight: 0.9 },
        bsa: { triggers: ['bsa', 'بی اس ای', 'سطح بدن', 'body surface area', 'mosteller'], scoreWeight: 0.9 },
        ibw: { triggers: ['وزن ایده‌آل', 'ideal weight', 'ibw', 'وزن استاندارد'], scoreWeight: 0.9 },
        crcl: { triggers: ['crcl', 'کلیرانس کراتینین', 'creatinine clearance', 'کراتینین'], scoreWeight: 0.9 },
        drip: { triggers: ['drip', 'قطره', 'سرعت قطره', 'gravity', 'قطره در دقیقه'], scoreWeight: 0.9 },
        gcs: { triggers: ['gcs', 'گلاسکو', 'glasgow', 'کما'], scoreWeight: 0.8 },
        rass: { triggers: ['rass', 'ریچموند', 'richmond', 'آرام‌بخشی', 'آژیتیشن'], scoreWeight: 0.8 },
        braden: { triggers: ['braden', 'برادن', 'زخم فشاری', 'pressure ulcer'], scoreWeight: 0.8 },
        morse: { triggers: ['morse', 'مورس', 'سقوط', 'fall'], scoreWeight: 0.8 },
        burns: { triggers: ['burns', 'سوختگی', 'درصد سوختگی', 'tbsa', 'قانون نُه', 'پارکلند'], scoreWeight: 0.8 },
        oxygen: { triggers: ['oxygen', 'اکسیژن', 'کپسول', 'cylinder', 'جریان', 'فشار'], scoreWeight: 0.8 },
        vbg: { triggers: ['vbg', 'وی بی جی', 'گاز خون', 'blood gas', 'ph', 'pco2', 'hco3', 'اسید باز'], scoreWeight: 0.8 },
        ventilator: { triggers: ['ventilator', 'ونتیلاتور', 'حجم جاری', 'tidal volume', 'pbw', 'ards'], scoreWeight: 0.8 },
        nutrition: { triggers: ['nutrition', 'تغذیه', 'کالری', 'calories', 'protein', 'پروتئین', 'bmr'], scoreWeight: 0.8 },
        convert: { triggers: ['convert', 'تبدیل', 'meq', 'میلی‌اکی‌والان', 'الکترولیت'], scoreWeight: 0.9 },
        electrolyte: { triggers: ['الکترولیت', 'تبدیل الکترولیت', 'سدیم', 'پتاسیم', 'کلسیم', 'منیزیم', 'بی‌کربنات'], scoreWeight: 0.9 },
        percentage: { triggers: ['درصد', 'غلظت درصد', 'percentage solution', 'محلول درصدی'], scoreWeight: 0.9 },
        unit_convert: { triggers: ['تبدیل واحد', 'واحد', 'میکروگرم', 'میلی‌گرم', 'gram', 'unit conversion'], scoreWeight: 0.9 },
        temp_convert: { triggers: ['تبدیل دما', 'درجه', 'سلسیوس', 'فارنهایت', 'temperature'], scoreWeight: 0.9 },
        weight_convert: { triggers: ['تبدیل وزن', 'کیلوگرم', 'پوند', 'گرم', 'weight conversion'], scoreWeight: 0.9 },
        drug: { triggers: ['دارو', 'دوز', 'انفوزیون', 'تزریق', 'پمپ', 'سرنگ', 'میکروگرم', 'میلی‌گرم', 'واحد', 'kg/h', 'mcg', 'mg', 'units', 'میلی‌لیتر', 'سی‌سی', 'حجم', 'محلول', 'آمپول', 'ویال'], scoreWeight: 1.0 },
        druginfo: { triggers: ['اطلاعات', 'درباره', 'توضیح', 'شرح', 'کاربرد', 'مقدار مصرف', 'نحوه مصرف', 'چیه', 'چیست', 'info', 'about', 'describe'], scoreWeight: 0.9 },
        dose_calc: { triggers: ['دوز', 'حجم ویال', 'dose calculation', 'vial', 'حجم تزریقی'], scoreWeight: 0.9 },
        compat_tool: { triggers: ['سازگاری', 'compatibility', 'تداخل دارویی', 'ysite', 'y-site', 'مخلوط'], scoreWeight: 0.9 },
        ysite: { triggers: ['ysite', 'y-site', 'سازگاری', 'تداخل', 'مخلوط', 'همزمان'], scoreWeight: 0.8 },
        settings: { triggers: ['تنظیمات', 'settings', 'dark mode', 'light mode', 'تاریک', 'روشن', 'دارک', 'لایت', 'فونت بزرگ', 'فونت کوچک'], scoreWeight: 0.7 },
        theme: { triggers: ['تم', 'theme', 'فاکس', 'fox', 'روباه', 'اقیانوس', 'ocean', 'رز', 'rose', 'جنگل', 'forest', 'dreamfire', 'شرابی'], scoreWeight: 0.9 },
        help: { triggers: ['help', 'راهنما', 'کمک', 'نمونه', 'example', 'چه کارایی', 'راهنمایی'], scoreWeight: 0.6 }
    };

    function scoreCommand(text, params) {
        const lower = text.toLowerCase();
        const scores = {};
        for (const [cmd, info] of Object.entries(COMMANDS)) {
            let score = 0;
            for (const trigger of info.triggers) {
                if (fuzzyMatch(lower, trigger, 2)) {
                    score += 1;
                }
            }
            if (cmd === 'bmi' && params.weight && params.height) score += 3;
            if (cmd === 'bsa' && params.weight && params.height) score += 3;
            if (cmd === 'crcl' && params.age && params.weight && params.dose) score += 3;
            if (cmd === 'drip' && params.volume && params.time) score += 3;
            if (cmd === 'gcs' && (params.gcs_eye || params.gcs_verbal || params.gcs_motor)) score += 3;
            if (cmd === 'rass' && params.rassScore !== undefined) score += 3;
            if (cmd === 'burns' && (text.includes('سوختگی') || params.burnPercent)) score += 3;
            if (cmd === 'vbg' && (params.pH || params.pco2 || params.hco3)) score += 3;
            if (cmd === 'ventilator' && params.height) score += 3;
            if (cmd === 'nutrition' && (params.weight || params.height || params.age)) score += 3;
            if (cmd === 'ysite' && (params.drug1 || params.drug2)) score += 3;
            if (cmd === 'drug' && params.drugId) score += 4;
            if (cmd === 'druginfo' && params.drugId) score += 3;
            if (cmd === 'oxygen' && (params.flow || params.pressure || params.liters)) score += 3;
            scores[cmd] = score * info.scoreWeight;
        }
        return scores;
    }

    // ------------------------------------------------------------
    // FAST COMMANDS
    // ------------------------------------------------------------
    const FAST_COMMANDS = {
        'تاریک': function () {
            try {
                AppState.settings.themeMode = 'dark';
                if (typeof saveSettings === 'function') saveSettings();
                if (typeof applyThemeMode === 'function') applyThemeMode();
                showVoiceResult('حالت تاریک فعال شد', 'success');
            } catch (e) { showVoiceResult('خطا در تغییر تم: ' + e.message, 'error'); }
        },
        'روشن': function () {
            try {
                AppState.settings.themeMode = 'light';
                if (typeof saveSettings === 'function') saveSettings();
                if (typeof applyThemeMode === 'function') applyThemeMode();
                showVoiceResult('حالت روشن فعال شد', 'success');
            } catch (e) { showVoiceResult('خطا در تغییر تم: ' + e.message, 'error'); }
        },
        'فونت بزرگ': function () {
            try {
                AppState.settings.largeFont = true;
                if (typeof saveSettings === 'function') saveSettings();
                if (typeof applySettings === 'function') applySettings();
                showVoiceResult('فونت بزرگ فعال شد', 'success');
            } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
        },
        'فونت معمولی': function () {
            try {
                AppState.settings.largeFont = false;
                if (typeof saveSettings === 'function') saveSettings();
                if (typeof applySettings === 'function') applySettings();
                showVoiceResult('فونت معمولی فعال شد', 'success');
            } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
        },
        'راهنما': function () {
            showVoiceResult('دستورات نمونه: «هپارین ۱۲ واحد/کیلوگرم/ساعت وزن ۷۰»، «BMI وزن ۷۵ قد ۱۷۵»، «قطره ۵۰۰ میلی‌لیتر در ۸ ساعت»، «تاریک»، «فونت بزرگ»', 'info');
        },
        'ماشین حساب': function () {
            try {
                if (typeof switchTab === 'function') switchTab('calculator');
                showVoiceResult('بخش ماشین حساب باز شد', 'success');
            } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
        },
        'داروها': function () {
            try {
                if (typeof switchTab === 'function') switchTab('drugs');
                showVoiceResult('مرجع داروها باز شد', 'success');
            } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
        },
        'ابزارها': function () {
            try {
                if (typeof switchTab === 'function') switchTab('tools');
                showVoiceResult('ابزارهای بالینی باز شد', 'success');
            } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
        }
    };

    // ------------------------------------------------------------
    // SMALL TALK (condensed for brevity)
    // ------------------------------------------------------------
    function trySmallTalk(normalized, lower) {
        const hasNumber = /\d/.test(normalized);
        if (findDrugName(normalized) || hasNumber || normalized.length >= 50) return false;
        const replies = {
            'سلام|درود|هلو': ['سلام! وقت بخیر 🌸', 'درود بر شما ✨', 'سلام! امیدوارم روز خوبی داشته باشی ☀️'],
            'صبح بخیر': ['صبح شما هم بخیر ☀️', 'صبح بخیر! روز آرومی باشه 🌅'],
            'شب بخیر': ['شب بخیر 🌙', 'شب شما هم بخیر 💫'],
            'ممنون|مرسی': ['خواهش می‌کنم ☺️', 'قابل نداشت 🌸'],
            'خداحافظ|بای': ['خداحافظ! مراقب خودت باش 🌸', 'فعلا 👋']
        };
        for (const [pattern, msgs] of Object.entries(replies)) {
            if (new RegExp(pattern, 'i').test(lower)) {
                showVoiceResult(msgs[Math.floor(Math.random() * msgs.length)], 'success');
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------
    // MAIN PROCESSING
    // ------------------------------------------------------------
    function process(text) {
        try {
            if (!text || !text.trim()) return;
            console.log('[Voice] Raw:', text);
            const normalized = normalizeText(text);
            const lower = normalized.toLowerCase();
            console.log('[Voice] Normalized:', normalized);

            // Fast commands
            for (const [key, fn] of Object.entries(FAST_COMMANDS)) {
                if (lower === key || lower === 'برو به ' + key || lower === 'رفتن به ' + key) {
                    fn();
                    return;
                }
            }

            // Theme shortcuts (fast)
            if (lower.includes('dark mode') || lower.includes('دارک') || lower.includes('تاریک') || lower.includes('حالت شب')) {
                try {
                    AppState.settings.themeMode = 'dark';
                    if (typeof saveSettings === 'function') saveSettings();
                    if (typeof applyThemeMode === 'function') applyThemeMode();
                    showVoiceResult('حالت تاریک فعال شد', 'success');
                } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
                return;
            }
            if (lower.includes('light mode') || lower.includes('لایت') || lower.includes('روشن') || lower.includes('حالت روز')) {
                try {
                    AppState.settings.themeMode = 'light';
                    if (typeof saveSettings === 'function') saveSettings();
                    if (typeof applyThemeMode === 'function') applyThemeMode();
                    showVoiceResult('حالت روشن فعال شد', 'success');
                } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
                return;
            }
            if (lower.includes('large font') || lower.includes('فونت بزرگ')) {
                try {
                    AppState.settings.largeFont = true;
                    if (typeof saveSettings === 'function') saveSettings();
                    if (typeof applySettings === 'function') applySettings();
                    showVoiceResult('فونت بزرگ فعال شد', 'success');
                } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
                return;
            }
            if (lower.includes('small font') || lower.includes('فونت کوچک') || lower.includes('فونت معمولی')) {
                try {
                    AppState.settings.largeFont = false;
                    if (typeof saveSettings === 'function') saveSettings();
                    if (typeof applySettings === 'function') applySettings();
                    showVoiceResult('فونت معمولی فعال شد', 'success');
                } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
                return;
            }

            // Small talk
            if (trySmallTalk(normalized, lower)) return;

            // Extract parameters
            const params = extractParams(normalized);
            console.log('[Voice] Params:', params);

            // Drug info
            if (lower.includes('اطلاعات') || lower.includes('درباره') || lower.includes('توضیح') || lower.includes('چیه') || lower.includes('چیست') || lower.includes('info')) {
                const drugId = params.drugId || findDrugName(normalized);
                if (drugId) {
                    executeCommand('druginfo', normalized, { drugId: drugId });
                    return;
                }
            }

            // BSA shortcut
            if ((lower.includes('سطح بدن') || lower.includes('body surface')) && params.weight && params.height) {
                executeCommand('bsa', normalized, params);
                return;
            }

            // If weight & height present, default to BMI
            if (params.weight && params.height && !lower.includes('bsa') && !lower.includes('سطح بدن')) {
                executeCommand('bmi', normalized, params);
                return;
            }

            // If pH, pCO2, HCO3 present, default to VBG
            if (params.pH && params.pco2 && params.hco3) {
                executeCommand('vbg', normalized, params);
                return;
            }

            // If burn percentage present, default to burns
            if (params.burnPercent !== undefined && params.burnPercent > 0) {
                executeCommand('burns', normalized, params);
                return;
            }

            // Score commands
            const scores = scoreCommand(normalized, params);
            const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
            const best = sorted[0];

            if (!best || best[1] === 0) {
                if (params.drugId && params.dose) {
                    executeCommand('drug', normalized, params);
                    return;
                }
                showVoiceResult('متوجه نشدم. لطفاً واضح‌تر بگویید یا از دکمه‌های نمونه استفاده کنید.\nمثلاً: «بی ام ای وزن ۷۰ قد ۱۷۵» یا «هپارین ۱۲ واحد/کیلوگرم/ساعت وزن ۷۰»', 'error');
                return;
            }

            // Confirmation
            const second = sorted[1];
            if (second && (best[1] - second[1]) < 0.5) {
                pendingConfirmation = { command: best[0], params: params, text: normalized };
                const cmdName = best[0].replace('_', ' ');
                showVoiceResult(`آیا منظور شما "${cmdName}" بود؟ بگویید «بله» یا «خیر»`, 'info');
                setTimeout(() => { pendingConfirmation = null; }, 10000);
                return;
            }

            executeCommand(best[0], normalized, params);

        } catch (e) {
            console.error('[Voice] Error in process:', e);
            showVoiceResult('خطا در پردازش دستور: ' + e.message, 'error');
        }
    }

    // ------------------------------------------------------------
    // CONFIRMATION HANDLER
    // ------------------------------------------------------------
    function handleConfirmation(text) {
        if (!pendingConfirmation) return false;
        const lower = text.toLowerCase();
        if (lower.includes('نه') || lower.includes('خیر') || lower.includes('no')) {
            const rest = text.replace(/نه|خیر|no/gi, '').trim();
            if (rest) {
                pendingConfirmation = null;
                process(rest);
                return true;
            } else {
                pendingConfirmation = null;
                showVoiceResult('دستور لغو شد.', 'info');
                return true;
            }
        } else if (lower.includes('بله') || lower.includes('آره') || lower.includes('اوکی') || lower.includes('yes')) {
            const { command, params, text: original } = pendingConfirmation;
            pendingConfirmation = null;
            executeCommand(command, original, params);
            return true;
        }
        return false;
    }

    // ------------------------------------------------------------
    // ACCORDION HELPER
    // ------------------------------------------------------------
    function openAccordionById(id) {
        try {
            const body = document.getElementById(id);
            if (body) {
                const item = body.closest('.accordion-item');
                if (item) {
                    document.querySelectorAll('.accordion-item.open').forEach(el => {
                        if (el !== item) {
                            el.classList.remove('open');
                            const b = el.querySelector('.accordion-body');
                            if (b) b.style.maxHeight = '0';
                        }
                    });
                    item.classList.add('open');
                    body.style.maxHeight = body.scrollHeight + 200 + 'px';
                    setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
                }
            }
        } catch (e) {
            console.warn('[Voice] openAccordionById error:', e);
        }
    }

    // ------------------------------------------------------------
    // TOOL HANDLERS (with safety checks)
    // ------------------------------------------------------------
    function safeCall(fn, ...args) {
        try {
            if (typeof fn === 'function') return fn(...args);
            console.warn('[Voice] Function not available:', fn);
        } catch (e) {
            console.error('[Voice] Error in safeCall:', e);
            showVoiceResult('خطا: ' + e.message, 'error');
        }
        return null;
    }

    function handleBMIVoice(params) {
        setTimeout(() => openAccordionById('bmiAccordionBody'), 300);
        if (params.weight) document.getElementById('bmiWeight').value = params.weight;
        if (params.height) document.getElementById('bmiHeight').value = params.height;
        safeCall(calculateBMI);
        showVoiceResult('BMI محاسبه شد', 'success');
    }

    function handleBSAVoice(params) {
        setTimeout(() => openAccordionById('bsaAccordionBody'), 300);
        if (params.weight) document.getElementById('bsaWeight').value = params.weight;
        if (params.height) document.getElementById('bsaHeight').value = params.height;
        safeCall(calculateBSA);
        showVoiceResult('BSA محاسبه شد', 'success');
    }

    function handleIBWVoice() {
        setTimeout(() => openAccordionById('ibwAccordionBody'), 300);
        safeCall(calculateIBW);
        showVoiceResult('وزن ایده‌آل محاسبه شد', 'success');
    }

    function handleCrClVoice(params) {
        setTimeout(() => openAccordionById('crclAccordionBody'), 300);
        if (params.age) document.getElementById('crclAge').value = params.age;
        if (params.weight) document.getElementById('crclWeight').value = params.weight;
        if (params.dose) document.getElementById('crclValue').value = params.dose;
        if (params.gender) document.getElementById('crclGender').value = params.gender;
        safeCall(calculateCrCl);
        showVoiceResult('کلیرانس کراتینین محاسبه شد', 'success');
    }

    function handleDripRateVoice(params) {
        setTimeout(() => openAccordionById('dripAccordionBody'), 300);
        if (params.volume) document.getElementById('dripVolume').value = params.volume;
        if (params.time) document.getElementById('dripTime').value = params.time;
        safeCall(calculateDripRateLive);
        showVoiceResult('نرخ قطره محاسبه شد', 'success');
    }

    function handleGCSVoice(text, params) {
        setTimeout(() => openAccordionById('gcsAccordionBody'), 300);
        if (params.gcs_eye) {
            document.querySelectorAll('.gcs-btn[data-domain="eye"]').forEach(b => {
                if (parseInt(b.dataset.score) === params.gcs_eye) b.click();
            });
        }
        if (params.gcs_verbal) {
            document.querySelectorAll('.gcs-btn[data-domain="verbal"]').forEach(b => {
                if (parseInt(b.dataset.score) === params.gcs_verbal) b.click();
            });
        }
        if (params.gcs_motor) {
            document.querySelectorAll('.gcs-btn[data-domain="motor"]').forEach(b => {
                if (parseInt(b.dataset.score) === params.gcs_motor) b.click();
            });
        }
        showVoiceResult('GCS تنظیم شد', 'success');
    }

    function handleRASSVoice(text, params) {
        setTimeout(() => openAccordionById('rassAccordionBody'), 300);
        if (params.rassScore !== undefined) {
            document.querySelectorAll('.rass-level').forEach(el => {
                if (parseInt(el.dataset.score) === params.rassScore) el.click();
            });
        }
        showVoiceResult('RASS تنظیم شد', 'success');
    }

    function handleBradenVoice(params) {
        setTimeout(() => openAccordionById('bradenAccordionBody'), 300);
        showVoiceResult('مقیاس برادن تنظیم شد', 'success');
    }

    function handleMorseVoice(params) {
        setTimeout(() => openAccordionById('morseAccordionBody'), 300);
        showVoiceResult('مقیاس مورس تنظیم شد', 'success');
    }

    function handleBurnsVoice(text) {
        setTimeout(() => openAccordionById('burnsAccordionBody'), 300);
        showVoiceResult('بخش سوختگی باز شد', 'info');
    }

    function handleOxygenVoice(params) {
        setTimeout(() => openAccordionById('oxygenAccordionBody'), 300);
        if (params.liters) document.getElementById('oxyCylinderSize').value = params.liters;
        if (params.pressure) document.getElementById('oxyPressure').value = params.pressure;
        if (params.flow) document.getElementById('oxyFlow').value = params.flow;
        safeCall(calculateOxygen);
        showVoiceResult('مدت کپسول اکسیژن محاسبه شد', 'success');
    }

    function handleVBGVoice(text, params) {
        setTimeout(() => openAccordionById('vbgAccordionBody'), 300);
        if (params.pH) document.getElementById('vbgPH').value = params.pH;
        if (params.pco2) document.getElementById('vbgPCO2').value = params.pco2;
        if (params.hco3) document.getElementById('vbgHCO3').value = params.hco3;
        safeCall(interpretVBG);
        showVoiceResult('تفسیر گازهای خون انجام شد', 'success');
    }

    function handleVentilatorVoice(text, params) {
        setTimeout(() => openAccordionById('ventilatorAccordionBody'), 300);
        if (params.height) document.getElementById('ventHeight').value = params.height;
        if (params.gender) {
            document.querySelectorAll('#ventGenderBtns .method-btn-compact').forEach(b => {
                if (b.dataset.gender === params.gender) b.click();
            });
        }
        safeCall(calculateVentTV);
        showVoiceResult('حجم جاری ونتیلاتور محاسبه شد', 'success');
    }

    function handleNutritionVoice(text, params) {
        setTimeout(() => openAccordionById('nutritionAccordionBody'), 300);
        if (params.weight) document.getElementById('nutWeight').value = params.weight;
        if (params.height) document.getElementById('nutHeight').value = params.height;
        if (params.age) document.getElementById('nutAge').value = params.age;
        if (params.gender) {
            document.querySelectorAll('#nutGenderBtns .method-btn-compact').forEach(b => {
                if (b.dataset.gender === params.gender) b.click();
            });
        }
        if (text.includes('سپسیس') || text.includes('sepsis')) document.getElementById('nutStress').value = '1.35';
        else if (text.includes('سوختگی')) document.getElementById('nutStress').value = '1.5';
        else if (text.includes('آردس') || text.includes('ards')) document.getElementById('nutStress').value = '2.0';
        else document.getElementById('nutStress').value = '1.2';
        safeCall(calculateNutrition);
        showVoiceResult('نیاز تغذیه‌ای محاسبه شد', 'success');
    }

    function handleElectrolyteVoice(params) {
        setTimeout(() => openAccordionById('electrolyteAccordionBody'), 300);
        if (params.electrolyte) document.getElementById('electrolyteElement').value = params.electrolyte;
        safeCall(convertElectrolyteLive, 'meq');
        showVoiceResult('تبدیل الکترولیت انجام شد', 'success');
    }

    function handlePercentageVoice() {
        setTimeout(() => openAccordionById('percentageAccordionBody'), 300);
        safeCall(convertPercentageLive);
        showVoiceResult('غلظت درصد محاسبه شد', 'success');
    }

    function handleUnitConvertVoice() {
        setTimeout(() => openAccordionById('unitAccordionBody'), 300);
        safeCall(convertUnitsLive, 'from');
        showVoiceResult('تبدیل واحد انجام شد', 'success');
    }

    function handleTempConvertVoice() {
        setTimeout(() => openAccordionById('tempAccordionBody'), 300);
        safeCall(convertTempLive, 'c');
        showVoiceResult('تبدیل دما انجام شد', 'success');
    }

    function handleWeightConvertVoice() {
        setTimeout(() => openAccordionById('weightAccordionBody'), 300);
        safeCall(convertWeightLive, 'kg');
        showVoiceResult('تبدیل وزن انجام شد', 'success');
    }

    function handleDoseCalcVoice() {
        setTimeout(() => openAccordionById('doseCalcAccordionBody'), 300);
        safeCall(populateDoseCalcFromDrug);
        safeCall(calculateDose);
        showVoiceResult('محاسبه دوز انجام شد', 'success');
    }

    function handleYSiteVoice(text, params) {
        setTimeout(() => openAccordionById('ysiteAccordionBody'), 300);
        const ids = findAllDrugNames(text, 2);
        const d1 = params.drug1 || ids[0];
        const d2 = params.drug2 || ids[1];
        if (d1 && d2) {
            document.querySelectorAll('#ysiteDrugGrid .ysite-drug-chip').forEach(chip => {
                if (chip.dataset.id === d1 || chip.dataset.id === d2) chip.click();
            });
            showVoiceResult('سازگاری Y-Site بررسی شد', 'success');
        } else {
            showVoiceResult('لطفاً دو دارو را وارد کنید', 'error');
        }
    }

    // ------------------------------------------------------------
    // DRUG HANDLERS
    // ------------------------------------------------------------
    function handleDrugVoice(text, params) {
        try {
            const drugId = params.drugId || findDrugName(text);
            if (!drugId) {
                showVoiceResult('دارو شناسایی نشد.', 'error');
                return;
            }

            if (typeof selectDrug !== 'function') {
                showVoiceResult('تابع انتخاب دارو در دسترس نیست.', 'error');
                return;
            }
            selectDrug(drugId);
            const drug = drugDatabase[drugId];

            // Method
            if (params.method) {
                document.querySelectorAll('.method-btn-compact').forEach(btn => {
                    if (btn.dataset.method === params.method) btn.click();
                });
            }

            // Volume
            if (params.volume !== undefined) {
                const methodKey = AppState.infusionMethod;
                const volumes = drug.defaultSolutionVolumes[methodKey];
                if (volumes && volumes.includes(params.volume)) {
                    document.querySelectorAll('.volume-preset-btn').forEach(btn => {
                        if (parseInt(btn.dataset.volume) === params.volume) btn.click();
                    });
                } else if (DOM.customVolumeContainer) {
                    DOM.customVolumeContainer.style.display = 'flex';
                    DOM.customVolume.value = params.volume;
                    DOM.customVolume.dataset.numericValue = params.volume;
                    AppState.customVolume = true;
                    document.querySelectorAll('.volume-preset-btn').forEach(b => b.classList.remove('active'));
                }
            }

            // Ampoules
            if (params.ampoules) {
                AppState.ampouleCount = Math.max(1, params.ampoules);
                if (typeof updateAmpouleInfo === 'function') updateAmpouleInfo();
                const ampDisplay = document.getElementById('ampouleCount');
                if (ampDisplay) ampDisplay.textContent = AppState.ampouleCount;
            }

            // Custom amount
            if (params.customAmount !== undefined && params.customUnit) {
                const isInsulin = drug.id === 'insulin';
                if (!isInsulin && DOM.customAmountToggleClickRow) DOM.customAmountToggleClickRow.click();
                if (DOM.customAmountInput) {
                    DOM.customAmountInput.value = params.customAmount;
                    DOM.customAmountInput.dataset.numericValue = params.customAmount;
                }
            }

            // Weight
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
                if (typeof updateWeightBasedUnit === 'function') updateWeightBasedUnit(drug);
            } else if (DOM.weightCheckbox) {
                DOM.weightCheckbox.checked = false;
                AppState.useWeight = false;
                if (DOM.weightIosToggle) DOM.weightIosToggle.classList.remove('on');
                if (DOM.weightInputRow) DOM.weightInputRow.style.display = 'none';
                if (DOM.patientWeight) DOM.patientWeight.disabled = true;
            }

            // Dose
            let doseVal = params.dose || null;
            if (!doseVal || doseVal <= 0) {
                const numberMatch = text.match(/\d+(?:\.\d+)?/);
                if (numberMatch) doseVal = parseFloat(numberMatch[0]);
            }
            if (doseVal !== null && doseVal > 0) {
                if (DOM.doctorOrder) {
                    DOM.doctorOrder.value = doseVal;
                    DOM.doctorOrder.dataset.numericValue = doseVal;
                }
            } else {
                showVoiceResult('دوز مشخص نشد.', 'error');
                return;
            }

            if (AppState.currentTab !== 'calculator' && typeof switchTab === 'function') switchTab('calculator');
            if (typeof updateDoseRangeIndicator === 'function') updateDoseRangeIndicator();
            if (AppState.reverseMode) {
                if (typeof calculateReverse === 'function') calculateReverse();
            } else {
                if (typeof calculateInfusion === 'function') calculateInfusion();
            }
            setTimeout(() => {
                const results = document.getElementById('resultsSection');
                if (results && results.style.display === 'block') {
                    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 300);
            showVoiceResult('محاسبه ' + drug.persianName + ' انجام شد.', 'success');
        } catch (e) {
            console.error('[Voice] Drug handler error:', e);
            showVoiceResult('خطا در محاسبه دارو: ' + e.message, 'error');
        }
    }

    function handleDrugInfo(text, params) {
        try {
            const drugId = params.drugId || findDrugName(text);
            if (!drugId) { showVoiceResult('دارو شناسایی نشد.', 'error'); return; }
            const drug = drugDatabase[drugId];
            if (!drug) { showVoiceResult('دارو در پایگاه داده موجود نیست.', 'error'); return; }

            if (typeof switchTab === 'function') switchTab('drugs');
            setTimeout(() => {
                const item = document.querySelector(`.qref-accordion-item[data-drug-id="${drugId}"]`);
                if (item) {
                    const row = item.querySelector('.qref-row');
                    if (row && row.dataset.bodyId && typeof toggleAccordionById === 'function') {
                        toggleAccordionById(row.dataset.bodyId);
                        setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
                    } else if (row) {
                        row.click();
                    }
                }
                showVoiceResult('✅ اطلاعات ' + drug.persianName + ' باز شد.', 'success');
            }, 300);
        } catch (e) {
            console.error('[Voice] Drug info error:', e);
            showVoiceResult('خطا: ' + e.message, 'error');
        }
    }

    function handleThemeVoice(text) {
        try {
            const themeMap = {
                'fox':'fox','فاکس':'fox','روباه':'fox',
                'ocean':'ocean','اقیانوس':'ocean','سایرن':'ocean',
                'rose':'rose','رز':'rose','ویکسن':'rose',
                'forest':'forest','جنگل':'forest','لینکس':'forest',
                'dreamfire':'dreamfire','شرابی':'dreamfire','زرشکی':'dreamfire','گیلاسی':'dreamfire',
                'default':'default','پیش‌فرض':'default','هدو':'default'
            };
            const lower = text.toLowerCase();
            let found = null;
            for (const [key, val] of Object.entries(themeMap)) {
                if (lower.includes(key)) { found = val; break; }
            }
            if (found) {
                AppState.settings.colorTheme = found;
                if (typeof saveSettings === 'function') saveSettings();
                if (typeof applyTheme === 'function') applyTheme(found);
                showVoiceResult('تم ' + found + ' فعال شد', 'success');
            } else {
                showVoiceResult('تم شناسایی نشد', 'error');
            }
        } catch (e) {
            showVoiceResult('خطا: ' + e.message, 'error');
        }
    }

    // ------------------------------------------------------------
    // EXECUTION DISPATCHER
    // ------------------------------------------------------------
    function executeCommand(cmd, text, params) {
        try {
            lastCommand = cmd;
            lastParams = params;

            const toolCommands = ['bmi','bsa','ibw','crcl','drip','gcs','rass','braden','morse','burns','oxygen','vbg','ventilator','nutrition','electrolyte','percentage','unit_convert','temp_convert','weight_convert','dose_calc','compat_tool','ysite'];
            if (toolCommands.includes(cmd) && typeof switchTab === 'function') {
                switchTab('tools');
            }

            switch (cmd) {
                case 'tab_calculator': if (typeof switchTab === 'function') switchTab('calculator'); showVoiceResult('بخش ماشین حساب باز شد', 'success'); break;
                case 'tab_drugs': if (typeof switchTab === 'function') switchTab('drugs'); showVoiceResult('مرجع داروها باز شد', 'success'); break;
                case 'tab_tools': if (typeof switchTab === 'function') switchTab('tools'); showVoiceResult('ابزارهای بالینی باز شد', 'success'); break;
                case 'clear': if (typeof clearResults === 'function') clearResults(); showVoiceResult('نتایج پاک شد', 'success'); break;
                case 'manual_calc': if (typeof switchTab === 'function') switchTab('calculator'); if (typeof openManualCalculation === 'function') openManualCalculation(); showVoiceResult('محاسبه دستی باز شد', 'success'); break;
                case 'history': if (typeof loadHistory === 'function') loadHistory(); if (DOM.historyModal) { DOM.historyModal.classList.add('active'); document.body.classList.add('no-scroll'); } showVoiceResult('تاریخچه محاسبات باز شد', 'success'); break;
                case 'reverse': AppState.reverseMode = !AppState.reverseMode; if (typeof updateReverseUI === 'function') updateReverseUI(); showVoiceResult(AppState.reverseMode ? 'حالت معکوس فعال شد' : 'حالت معکوس غیرفعال شد', 'info'); break;
                case 'bmi': handleBMIVoice(params); break;
                case 'bsa': handleBSAVoice(params); break;
                case 'ibw': handleIBWVoice(); break;
                case 'crcl': handleCrClVoice(params); break;
                case 'drip': handleDripRateVoice(params); break;
                case 'gcs': handleGCSVoice(text, params); break;
                case 'rass': handleRASSVoice(text, params); break;
                case 'braden': handleBradenVoice(params); break;
                case 'morse': handleMorseVoice(params); break;
                case 'burns': handleBurnsVoice(text); break;
                case 'oxygen': handleOxygenVoice(params); break;
                case 'vbg': handleVBGVoice(text, params); break;
                case 'ventilator': handleVentilatorVoice(text, params); break;
                case 'nutrition': handleNutritionVoice(text, params); break;
                case 'electrolyte': handleElectrolyteVoice(params); break;
                case 'percentage': handlePercentageVoice(); break;
                case 'unit_convert': handleUnitConvertVoice(); break;
                case 'temp_convert': handleTempConvertVoice(); break;
                case 'weight_convert': handleWeightConvertVoice(); break;
                case 'dose_calc': handleDoseCalcVoice(); break;
                case 'compat_tool':
                case 'ysite': handleYSiteVoice(text, params); break;
                case 'drug': handleDrugVoice(text, params); break;
                case 'druginfo': handleDrugInfo(text, params); break;
                case 'theme': handleThemeVoice(text); break;
                case 'help': showVoiceResult('دستورات نمونه: «هپارین ۱۲ واحد/کیلوگرم/ساعت وزن ۷۰»، «BMI وزن ۷۵ قد ۱۷۵»، «قطره ۵۰۰ میلی‌لیتر در ۸ ساعت»، «تبدیل ۲۰ mEq سدیم به mg»، «GCS 4 5 6»، «سوختگی»، «اکسیژن ۵ لیتر فشار ۱۵۰ بار جریان ۴»، «تغذیه وزن ۷۰ قد ۱۷۵ سن ۵۰»، «سازگاری هپارین و وانکومایسین»، «تاریک»، «فونت بزرگ»', 'info'); break;
                default: showVoiceResult('این دستور پشتیبانی نمی‌شود.', 'error');
            }

            const tips = {
                bmi: '💡 BSA با گفتن «BSA وزن ۷۰ قد ۱۷۰» محاسبه می‌شود.',
                bsa: '💡 BMI با گفتن «BMI وزن ۷۵ قد ۱۷۵».',
                crcl: '💡 جنسیت را هم مشخص کنید: «زن» یا «مرد».',
                drip: '💡 نوع ست: «ماکروست» یا «میکروست».',
                drug: '💡 روش تزریق، حجم و تعداد آمپول را هم می‌توانید مشخص کنید.',
                gcs: '💡 RASS را با «RASS 2» یا «RASS منفی ۳» بگویید.',
                rass: '💡 GCS را با «GCS 4 5 6» بگویید.',
                burns: '💡 روی نواحی سوختگی در تصویر کلیک کنید.',
                oxygen: '💡 فرمول: حجم × فشار × ۰.۹ ÷ جریان = مدت (دقیقه).',
                vbg: '💡 Na، Cl و آلبومین را برای آنیون گپ وارد کنید.',
                ventilator: '💡 از طول اولنا برای تخمین قد استفاده کنید.',
                nutrition: '💡 ضریب استرس را با «سپسیس» یا «سوختگی» تنظیم کنید.',
                ysite: '💡 دو دارو را در یک جمله بگویید.'
            };
            const tip = tips[cmd];
            if (tip && window.VoiceUI && typeof window.VoiceUI.appendTip === 'function') {
                setTimeout(() => window.VoiceUI.appendTip(tip), 1500);
            }
        } catch (e) {
            console.error('[Voice] executeCommand error:', e);
            showVoiceResult('خطا در اجرای دستور: ' + e.message, 'error');
        }
    }

    // ------------------------------------------------------------
    // GRAMMAR FOR VOSK
    // ------------------------------------------------------------
    let cachedGrammar = null;
    function buildVoiceGrammar() {
        if (cachedGrammar) return cachedGrammar;
        const words = new Set();
        function addPhrase(phrase) {
            if (!phrase) return;
            String(phrase).trim().split(/\s+/).forEach(w => { if (w) words.add(w); });
        }
        if (typeof drugDatabase !== 'undefined') {
            for (const id in drugDatabase) {
                const d = drugDatabase[id];
                addPhrase(d.persianName);
                addPhrase(d.englishName);
                (d.alternativeNames || []).forEach(addPhrase);
            }
        }
        for (const cmd in COMMANDS) {
            COMMANDS[cmd].triggers.forEach(addPhrase);
        }
        Object.keys(NUMBER_WORDS).forEach(addPhrase);
        words.add('[unk]');
        cachedGrammar = JSON.stringify(Array.from(words));
        return cachedGrammar;
    }

    // ------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------
    window.VoiceCommands = {
        process: function(text) {
            if (pendingConfirmation) {
                if (handleConfirmation(text)) return;
            }
            process(text);
        },
        getGrammar: buildVoiceGrammar
    };

    console.log('[Voice] VoiceCommands loaded successfully.');
})(window);
