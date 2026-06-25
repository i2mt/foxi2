/* ============================================
   FoxiMed — Voice Commands (Enhanced)
   ============================================ */
(function (window) {
    'use strict';

    // ------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------
    let lastCommand = null;
    let lastParams = null;
    let pendingConfirmation = null; // { command, params, text }

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
    // PERSIAN NUMBER PARSER (compound support)
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

    function parsePersianNumber(text) {
        let s = text;
        for (const word of NUMBER_KEYS) {
            const regex = new RegExp('\\b' + word + '\\b', 'gi');
            s = s.replace(regex, NUMBER_WORDS[word]);
        }
        let prev;
        do {
            prev = s;
            s = s.replace(/(\d+)\s*و\s*(\d+)/g, (match, a, b) => String(parseInt(a) + parseInt(b)));
        } while (s !== prev);
        const digits = s.match(/\d+(?:\.\d+)?/g);
        if (digits) return parseFloat(digits[0]);
        return null;
    }

    // ------------------------------------------------------------
    // PHRASE NORMALISATION (common mishearings and abbreviations)
    // ------------------------------------------------------------
    const PHRASE_MAP = {
        // BMI
        'بی ام ای': 'bmi',
        'بی ام آ': 'bmi',
        'بی ام آی': 'bmi',
        'بی‌ام‌ای': 'bmi',
        'بی‌ام‌آ': 'bmi',
        'بی‌ام‌آی': 'bmi',
        // BSA
        'بی اس ای': 'bsa',
        'بی‌اس‌ای': 'bsa',
        'سطح بدن': 'bsa',
        // GCS
        'گلاسکو': 'gcs',
        'گلاسگو': 'gcs',
        // RASS
        'ریچموند': 'rass',
        // VBG
        'وی بی جی': 'vbg',
        'وی‌بی‌جی': 'vbg',
        'گاز خون': 'vbg',
        // Burns
        'سوختگی': 'burns',
        'درصد سوختگی': 'burns',
        // Oxygen
        'اکسیژن': 'oxygen',
        'کپسول': 'oxygen',
        // Ventilator
        'ونتیلاتور': 'ventilator',
        'حجم جاری': 'ventilator',
        // Nutrition
        'تغذیه': 'nutrition',
        // Drugs
        'میکرون': 'میکرو',
        'میلی گرم': 'mg',
        'میلی‌گرم': 'mg',
        'میکرو گرم': 'mcg',
        'میکروگرم': 'mcg',
        'گرم': 'g',
        'واحد': 'units',
        'سی سی': 'cc',
        'سی‌سی': 'cc',
        'ساعت': 'hr',
        'دقیقه': 'min',
        // Numbers
        'سی': '30',
        'چهل': '40',
        'پنجاه': '50',
        'شصت': '60',
        'هفتاد': '70',
        'هشتاد': '80',
        'نود': '90',
    };

    function normalizeText(text) {
        let s = text;
        for (const [phrase, replacement] of Object.entries(PHRASE_MAP)) {
            const regex = new RegExp(phrase, 'gi');
            s = s.replace(regex, replacement);
        }
        for (const word of NUMBER_KEYS) {
            const regex = new RegExp('\\b' + word + '\\b', 'gi');
            s = s.replace(regex, NUMBER_WORDS[word]);
        }
        let prev;
        do {
            prev = s;
            s = s.replace(/(\d+)\s*و\s*(\d+)/g, (match, a, b) => String(parseInt(a) + parseInt(b)));
        } while (s !== prev);
        return s;
    }

    // ------------------------------------------------------------
    // DRUG NAME MATCHING (with fuzzy fallback)
    // ------------------------------------------------------------
    const DRUG_SYNONYMS = {
        'لازیس': 'lasix',
        'لازیک': 'lasix',
        'لازیکس': 'lasix',
        'فوروزماید': 'lasix',
        'هپارین': 'heparin',
        'هپارین سدیم': 'heparin',
        'فنتانیل': 'fentanyl',
        'فنتانیل سدیم': 'fentanyl',
        'میدازولام': 'midazolam',
        'ورسید': 'midazolam',
        'نوراپی نفرین': 'norepinephrine',
        'نورآدرنالین': 'norepinephrine',
        'دوپامین': 'dopamine',
        'اینوتروپ': 'dopamine',
        'آمیودارون': 'amiodarone',
        'کوردارون': 'amiodarone',
        'پنتوپرازول': 'pantoprazole',
        'پروتونیکس': 'pantoprazole',
        'لابتالول': 'labetalol',
        'تراندیت': 'labetalol',
        'اکترئوتاید': 'octreotide',
        'ساندوستاتین': 'octreotide',
        'نیتروگلیسیرین': 'tng',
        'تی ان جی': 'tng',
        'انسولین': 'insulin',
        'سوبلیماز': 'fentanyl',
        // Additional common mispronunciations
        'لازیکس': 'lasix',
        'هپارین سدیم': 'heparin',
        'فنتانیل سدیم': 'fentanyl',
        'میدازولام هیدروکلراید': 'midazolam',
        'نوراپی نفرین هیدروکلراید': 'norepinephrine',
        'دوپامین هیدروکلراید': 'dopamine',
        'آمیودارون هیدروکلراید': 'amiodarone',
        'پنتوپرازول سدیم': 'pantoprazole',
        'لابتالول هیدروکلراید': 'labetalol',
    };

    function findDrugName(text) {
        const lower = text.toLowerCase();
        // Exact synonyms
        for (const [alias, id] of Object.entries(DRUG_SYNONYMS)) {
            if (lower.includes(alias)) return id;
        }
        // Database exact matches
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
    // PARAMETER EXTRACTION (robust)
    // ------------------------------------------------------------
    function extractParams(text) {
        const params = {};
        const norm = normalizeText(text);
        const s = norm;

        // Weight
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

        // Height
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

        // Age
        const ageMatch = s.match(/(\d+(?:\.\d+)?)\s*(yr|سال|age)/i);
        if (ageMatch) params.age = parseFloat(ageMatch[1]);

        // Dose (generic number with unit)
        const doseMatch = s.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)/i);
        if (doseMatch) params.dose = parseFloat(doseMatch[1]);

        // Volume
        const volMatch = s.match(/(\d+(?:\.\d+)?)\s*(ml|mL|cc|سی‌سی)/i);
        if (volMatch) params.volume = parseFloat(volMatch[1]);

        // Time
        const timeMatch = s.match(/(\d+(?:\.\d+)?)\s*(hour|hr|ساعت|h)/i);
        if (timeMatch) params.time = parseFloat(timeMatch[1]);

        // Pressure
        const pressMatch = s.match(/(\d+(?:\.\d+)?)\s*(bar|psi|mmhg|cmh2o|kpa)/i);
        if (pressMatch) params.pressure = parseFloat(pressMatch[1]);

        // Flow
        const flowMatch = s.match(/(\d+(?:\.\d+)?)\s*(L\/min|litre\/min|لیتر در دقیقه)/i);
        if (flowMatch) params.flow = parseFloat(flowMatch[1]);

        // GCS
        const gcsMatch = s.match(/gcs\s*(\d+)\s*(\d+)\s*(\d+)/i);
        if (gcsMatch) {
            params.gcs_eye = parseInt(gcsMatch[1]);
            params.gcs_verbal = parseInt(gcsMatch[2]);
            params.gcs_motor = parseInt(gcsMatch[3]);
        }

        // RASS
        const rassMatch = s.match(/rass\s*([+-]?\d+)/i);
        if (rassMatch) params.rassScore = parseInt(rassMatch[1]);

        // VBG
        const phMatch = s.match(/ph\s*(\d+(?:\.\d+)?)/i);
        if (phMatch) params.pH = parseFloat(phMatch[1]);
        const pco2Match = s.match(/pco2\s*(\d+(?:\.\d+)?)/i);
        if (pco2Match) params.pco2 = parseFloat(pco2Match[1]);
        const hco3Match = s.match(/hco3\s*(\d+(?:\.\d+)?)/i);
        if (hco3Match) params.hco3 = parseFloat(hco3Match[1]);

        // Electrolyte
        const elecMatch = s.match(/(سدیم|پتاسیم|کلسیم|منیزیم|بی‌کربنات|bicarbonate)/i);
        if (elecMatch) {
            const map = { 'سدیم':'sodium', 'پتاسیم':'potassium', 'کلسیم':'calcium', 'منیزیم':'magnesium', 'بی‌کربنات':'sodium_bicarbonate', 'bicarbonate':'sodium_bicarbonate' };
            params.electrolyte = map[elecMatch[1].toLowerCase()] || null;
        }

        // Gender
        if (s.includes('male') || s.includes('مرد')) params.gender = 'male';
        else if (s.includes('female') || s.includes('زن')) params.gender = 'female';

        // Drug ID
        const drugId = findDrugName(s);
        if (drugId) params.drugId = drugId;

        // Y-Site
        const drugIds = findAllDrugNames(s, 2);
        if (drugIds.length === 2) {
            params.drug1 = drugIds[0];
            params.drug2 = drugIds[1];
        }

        // Custom amount
        const customMatch = s.match(/(دلخواه|مقدار)\s*(\d+(?:\.\d+)?)\s*(units|mg|mcg|g)/i);
        if (customMatch) {
            params.customAmount = parseFloat(customMatch[2]);
            params.customUnit = customMatch[3].toLowerCase();
        }

        // Burns percentage
        const burnPct = s.match(/(\d+(?:\.\d+)?)\s*(%|درصد)/i);
        if (burnPct) params.burnPercent = parseFloat(burnPct[1]);

        // Oxygen
        const oxySize = s.match(/(\d+(?:\.\d+)?)\s*(L|لیتر)/i);
        if (oxySize) params.liters = parseFloat(oxySize[1]);
        const oxyPressure = s.match(/(\d+(?:\.\d+)?)\s*(bar|بار)/i);
        if (oxyPressure) params.pressure = parseFloat(oxyPressure[1]);

        params._original = text;
        params._normalized = s;
        return params;
    }

    // ------------------------------------------------------------
    // COMMAND KEYWORDS with fuzzy matching
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
            // Contextual boosts (word-level importance)
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
            if (cmd === 'drug' && params.drugId) score += 4; // drug name boost
            if (cmd === 'druginfo' && params.drugId) score += 3;
            if (cmd === 'oxygen' && (params.flow || params.pressure || params.liters)) score += 3;
            // Number presence boosts generic commands
            if (params.dose && (cmd === 'drug' || cmd === 'dose_calc')) score += 2;
            scores[cmd] = score * info.scoreWeight;
        }
        return scores;
    }

    // ------------------------------------------------------------
    // FAST COMMANDS (exact matches)
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // SMALL TALK (unchanged from earlier full version)
    // ------------------------------------------------------------
    const SMALL_TALK = {
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
        'ببخشید|شرمنده|معذرت': [
            'نیازی به ببخشید نیست! 🌸 بگو چی لازم داری',
            'مشکلی نیست، همینجام 😊',
            'خواهش میکنم، راحت باش 🌼'
        ],
        'جوک بگو|بخندونم|یه چیز خنده‌دار بگو': [
            'یه روباه به دکتر گفت دکتر دلم درد میکنه، دکتر گفت لابد یه چیزی رو فاکسید کردی! 🦊😄',
            'تنها چیزی که این موقع شب بیشتر از قهوه بهم نیرو میده، دیدن یه شیفت بدون آلارم اضافه‌ست ☕😌',
            'اگه کدنویس‌ها هم مثل پرستارا شیفت شب میرفتن، الان نصف برنامه‌ها باگ داشت 😅'
        ],
        'خداحافظ|بای|فعلا|می بینمت|میرم دیگه': [
            'خداحافظ! مراقب خودت باش 🌸',
            'فعلا! هر وقت لازم شد من اینجام 👋',
            'به سلامت! شیفت خوبی داشته باشی ✨'
        ],
        'چطوری|خوبی|حالت چطوره|چطورید|چطورین': [
            'خوبم، ممنون! امیدوارم تو هم خوب باشی ❤️ چطور می‌تونم کمکت کنم؟',
            'عالی، چون دارم بهت کمک می‌کنم! 😊 تو چطوری؟',
            'من همیشه برای کمک بهت آماده‌ام! ☀️'
        ],
        'بله|اوکی|باشه|چشم|حتماً|خوبه': [
            'چشم! هر وقت آماده‌ای، بگو 📝',
            'باشه! منتظر فرمان شما هستم 🚀',
            'خوبه! هر کاری میتونم برات انجام بدم، بگو 🤝'
        ]
    };

    function trySmallTalk(normalized, lower) {
        const hasNumber = /\d/.test(normalized);
        if (findDrugName(normalized) || hasNumber || normalized.length >= 50) return false;
        for (const pattern in SMALL_TALK) {
            if (new RegExp(pattern, 'i').test(lower)) {
                const replies = SMALL_TALK[pattern];
                showVoiceResult(replies[Math.floor(Math.random() * replies.length)], 'success');
                return true;
            }
        }
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

    // ------------------------------------------------------------
    // MAIN PROCESSING
    // ------------------------------------------------------------
    function process(text) {
        if (!text || !text.trim()) return;
        // Log command for debugging
        console.log('[Voice] Raw transcript:', text);
        if (window.localStorage) {
            const log = JSON.parse(localStorage.getItem('voiceCommandLog') || '[]');
            log.push({ time: new Date().toISOString(), raw: text });
            if (log.length > 200) log.shift();
            localStorage.setItem('voiceCommandLog', JSON.stringify(log));
        }

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

        // Theme shortcuts
        if (lower.includes('dark mode') || lower.includes('دارک') || lower.includes('تاریک') || lower.includes('حالت شب')) {
            AppState.settings.themeMode = 'dark'; saveSettings(); applyThemeMode();
            showVoiceResult('حالت تاریک فعال شد', 'success'); return;
        }
        if (lower.includes('light mode') || lower.includes('لایت') || lower.includes('روشن') || lower.includes('حالت روز')) {
            AppState.settings.themeMode = 'light'; saveSettings(); applyThemeMode();
            showVoiceResult('حالت روشن فعال شد', 'success'); return;
        }
        if (lower.includes('large font') || lower.includes('فونت بزرگ')) {
            AppState.settings.largeFont = true; saveSettings(); applySettings();
            showVoiceResult('فونت بزرگ فعال شد', 'success'); return;
        }
        if (lower.includes('small font') || lower.includes('فونت کوچک') || lower.includes('فونت معمولی')) {
            AppState.settings.largeFont = false; saveSettings(); applySettings();
            showVoiceResult('فونت معمولی فعال شد', 'success'); return;
        }

        // Small talk
        if (trySmallTalk(normalized, lower)) return;

        // Extract parameters
        const params = extractParams(normalized);
        console.log('[Voice] Extracted params:', params);

        // Drug info
        if (lower.includes('اطلاعات') || lower.includes('درباره') || lower.includes('توضیح') || lower.includes('چیه') || lower.includes('چیست') || lower.includes('info')) {
            const drugId = params.drugId || findDrugName(normalized);
            if (drugId) { executeCommand('druginfo', normalized, { drugId: drugId }); return; }
        }

        // BSA shortcut
        if ((lower.includes('سطح بدن') || lower.includes('body surface')) && params.weight && params.height) {
            executeCommand('bsa', normalized, params); return;
        }

        // If weight and height present without a clear command, default to BMI
        if (params.weight && params.height && !lower.includes('bsa') && !lower.includes('سطح بدن')) {
            executeCommand('bmi', normalized, params); return;
        }

        // If pH, pCO2, HCO3 present, default to VBG
        if (params.pH && params.pco2 && params.hco3) {
            executeCommand('vbg', normalized, params); return;
        }

        // If burn percentage mentioned, default to burns
        if (params.burnPercent !== undefined && params.burnPercent > 0) {
            executeCommand('burns', normalized, params); return;
        }

        // Score commands
        const scores = scoreCommand(normalized, params);
        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const best = sorted[0];

        if (!best || best[1] === 0) {
            if (params.drugId && params.dose) {
                executeCommand('drug', normalized, params); return;
            }
            // Contextual help
            showVoiceResult('متوجه نشدم. لطفاً واضح‌تر بگویید یا از دکمه‌های نمونه استفاده کنید.\nمثلاً: «بی ام ای وزن ۷۰ قد ۱۷۵» یا «هپارین ۱۲ واحد/کیلوگرم/ساعت وزن ۷۰»', 'error');
            return;
        }

        // If top two scores are close, ask for confirmation
        const second = sorted[1];
        if (second && (best[1] - second[1]) < 0.5) {
            pendingConfirmation = { command: best[0], params: params, text: normalized };
            const cmdName = best[0].replace('_', ' ');
            showVoiceResult(`آیا منظور شما "${cmdName}" بود؟ بگویید «بله» یا «خیر»`, 'info');
            setTimeout(() => { pendingConfirmation = null; }, 10000);
            return;
        }

        executeCommand(best[0], normalized, params);
    }

    function handleConfirmation(text) {
        if (!pendingConfirmation) return false;
        const lower = text.toLowerCase();
        // Accept correction: "نه، BMI" or "خیر، BSA"
        if (lower.includes('نه') || lower.includes('خیر') || lower.includes('no')) {
            // Try to extract a new command from the rest of the text
            const rest = text.replace(/نه|خیر|no/gi, '').trim();
            if (rest) {
                // Process the corrected phrase
                pendingConfirmation = null;
                process(rest);
                return true;
            } else {
                pendingConfirmation = null;
                showVoiceResult('دستور لغو شد. لطفاً دوباره بگویید.', 'info');
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
    // ACCORDION HELPERS
    // ------------------------------------------------------------
    function openAccordionById(id) {
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
    }

    // ------------------------------------------------------------
    // TOOL HANDLERS
    // ------------------------------------------------------------
    function handleBMIVoice(params) {
        setTimeout(() => openAccordionById('bmiAccordionBody'), 300);
        if (params.weight) document.getElementById('bmiWeight').value = params.weight;
        if (params.height) document.getElementById('bmiHeight').value = params.height;
        calculateBMI();
        showVoiceResult('BMI محاسبه شد', 'success');
    }

    function handleBSAVoice(params) {
        setTimeout(() => openAccordionById('bsaAccordionBody'), 300);
        if (params.weight) document.getElementById('bsaWeight').value = params.weight;
        if (params.height) document.getElementById('bsaHeight').value = params.height;
        calculateBSA();
        showVoiceResult('BSA محاسبه شد', 'success');
    }

    function handleIBWVoice() {
        setTimeout(() => openAccordionById('ibwAccordionBody'), 300);
        calculateIBW();
        showVoiceResult('وزن ایده‌آل محاسبه شد', 'success');
    }

    function handleCrClVoice(params) {
        setTimeout(() => openAccordionById('crclAccordionBody'), 300);
        if (params.age) document.getElementById('crclAge').value = params.age;
        if (params.weight) document.getElementById('crclWeight').value = params.weight;
        if (params.dose) document.getElementById('crclValue').value = params.dose;
        if (params.gender) document.getElementById('crclGender').value = params.gender;
        calculateCrCl();
        showVoiceResult('کلیرانس کراتینین محاسبه شد', 'success');
    }

    function handleDripRateVoice(params) {
        setTimeout(() => openAccordionById('dripAccordionBody'), 300);
        if (params.volume) document.getElementById('dripVolume').value = params.volume;
        if (params.time) document.getElementById('dripTime').value = params.time;
        calculateDripRateLive();
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
        // If burn percent was extracted, we could auto-select regions, but UI is clickable.
        // We'll show info.
        showVoiceResult('بخش سوختگی باز شد — روی نواحی ضربه بزنید یا بگویید «سوختگی X درصد»', 'info');
    }

    function handleOxygenVoice(params) {
        setTimeout(() => openAccordionById('oxygenAccordionBody'), 300);
        if (params.liters) document.getElementById('oxyCylinderSize').value = params.liters;
        if (params.pressure) document.getElementById('oxyPressure').value = params.pressure;
        if (params.flow) document.getElementById('oxyFlow').value = params.flow;
        calculateOxygen();
        showVoiceResult('مدت کپسول اکسیژن محاسبه شد', 'success');
    }

    function handleVBGVoice(text, params) {
        setTimeout(() => openAccordionById('vbgAccordionBody'), 300);
        if (params.pH) document.getElementById('vbgPH').value = params.pH;
        if (params.pco2) document.getElementById('vbgPCO2').value = params.pco2;
        if (params.hco3) document.getElementById('vbgHCO3').value = params.hco3;
        interpretVBG();
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
        calculateVentTV();
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
        calculateNutrition();
        showVoiceResult('نیاز تغذیه‌ای محاسبه شد', 'success');
    }

    function handleElectrolyteVoice(params) {
        setTimeout(() => openAccordionById('electrolyteAccordionBody'), 300);
        if (params.electrolyte) document.getElementById('electrolyteElement').value = params.electrolyte;
        convertElectrolyteLive('meq');
        showVoiceResult('تبدیل الکترولیت انجام شد', 'success');
    }

    function handlePercentageVoice() {
        setTimeout(() => openAccordionById('percentageAccordionBody'), 300);
        convertPercentageLive();
        showVoiceResult('غلظت درصد محاسبه شد', 'success');
    }

    function handleUnitConvertVoice() {
        setTimeout(() => openAccordionById('unitAccordionBody'), 300);
        convertUnitsLive('from');
        showVoiceResult('تبدیل واحد انجام شد', 'success');
    }

    function handleTempConvertVoice() {
        setTimeout(() => openAccordionById('tempAccordionBody'), 300);
        convertTempLive('c');
        showVoiceResult('تبدیل دما انجام شد', 'success');
    }

    function handleWeightConvertVoice() {
        setTimeout(() => openAccordionById('weightAccordionBody'), 300);
        convertWeightLive('kg');
        showVoiceResult('تبدیل وزن انجام شد', 'success');
    }

    function handleDoseCalcVoice() {
        setTimeout(() => openAccordionById('doseCalcAccordionBody'), 300);
        populateDoseCalcFromDrug();
        calculateDose();
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
            showVoiceResult('لطفاً دو دارو را برای بررسی سازگاری وارد کنید', 'error');
        }
    }

    // ------------------------------------------------------------
    // DRUG HANDLERS (full implementation)
    // ------------------------------------------------------------
    function handleDrugVoice(text, params) {
        const drugId = params.drugId || findDrugName(text);
        if (!drugId) {
            showVoiceResult('دارو شناسایی نشد. لطفاً نام دارو را واضح بگویید.', 'error');
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
            if (volumes.includes(params.volume)) {
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
            updateAmpouleInfo();
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
            updateWeightBasedUnit(drug);
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
            showVoiceResult('دوز مشخص نشد. لطفاً مقدار دوز را بگویید.', 'error');
            return;
        }

        try {
            if (AppState.currentTab !== 'calculator') switchTab('calculator');
            updateDoseRangeIndicator();
            if (AppState.reverseMode) calculateReverse(); else calculateInfusion();
            setTimeout(() => {
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
        setTimeout(() => {
            const item = document.querySelector(`.qref-accordion-item[data-drug-id="${drugId}"]`);
            if (item) {
                const row = item.querySelector('.qref-row');
                if (row && row.dataset.bodyId) {
                    toggleAccordionById(row.dataset.bodyId);
                    setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
                } else if (row) {
                    row.click();
                }
            } else {
                document.querySelectorAll('.qref-accordion-item').forEach(el => {
                    const nameEl = el.querySelector('.qref-name');
                    if (nameEl && nameEl.textContent.includes(drug.persianName)) {
                        const row = el.querySelector('.qref-row');
                        if (row && row.dataset.bodyId) {
                            toggleAccordionById(row.dataset.bodyId);
                            setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
                        }
                    }
                });
            }
            showVoiceResult('✅ اطلاعات ' + drug.persianName + ' در بخش مرجع داروها باز شد.', 'success');
        }, 300);
    }

    function handleThemeVoice(text) {
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
            saveSettings(); applyTheme(found);
            showVoiceResult('تم ' + found + ' فعال شد', 'success');
        } else {
            showVoiceResult('تم شناسایی نشد', 'error');
        }
    }

    // ------------------------------------------------------------
    // EXECUTION DISPATCHER
    // ------------------------------------------------------------
    function executeCommand(cmd, text, params) {
        lastCommand = cmd;
        lastParams = params;

        const toolCommands = ['bmi','bsa','ibw','crcl','drip','gcs','rass','braden','morse','burns','oxygen','vbg','ventilator','nutrition','electrolyte','percentage','unit_convert','temp_convert','weight_convert','dose_calc','compat_tool','ysite'];
        if (toolCommands.includes(cmd)) {
            switchTab('tools');
        }

        switch (cmd) {
            case 'tab_calculator': switchTab('calculator'); showVoiceResult('بخش ماشین حساب باز شد', 'success'); break;
            case 'tab_drugs': switchTab('drugs'); showVoiceResult('مرجع داروها باز شد', 'success'); break;
            case 'tab_tools': switchTab('tools'); showVoiceResult('ابزارهای بالینی باز شد', 'success'); break;
            case 'clear': clearResults(); showVoiceResult('نتایج پاک شد', 'success'); break;
            case 'manual_calc': switchTab('calculator'); openManualCalculation(); showVoiceResult('محاسبه دستی باز شد', 'success'); break;
            case 'history': loadHistory(); if (DOM.historyModal) { DOM.historyModal.classList.add('active'); document.body.classList.add('no-scroll'); } showVoiceResult('تاریخچه محاسبات باز شد', 'success'); break;
            case 'reverse': AppState.reverseMode = !AppState.reverseMode; updateReverseUI(); showVoiceResult(AppState.reverseMode ? 'حالت معکوس فعال شد' : 'حالت معکوس غیرفعال شد', 'info'); break;
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
            default: showVoiceResult('این دستور هنوز پشتیبانی نمی‌شود.', 'error');
        }

        const tips = {
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
        const tip = tips[cmd];
        if (tip && window.VoiceUI && typeof window.VoiceUI.appendTip === 'function') {
            setTimeout(() => window.VoiceUI.appendTip(tip), 1500);
        }
    }

    // ------------------------------------------------------------
    // VOSK GRAMMAR (optional)
    // ------------------------------------------------------------
    let cachedGrammar = null;
    function buildVoiceGrammar() {
        if (cachedGrammar) return cachedGrammar;
        const words = new Set();
        function addPhrase(phrase) {
            if (!phrase) return;
            String(phrase).trim().split(/\s+/).forEach(w => { if (w) words.add(w); });
        }
        for (const id in drugDatabase) {
            const d = drugDatabase[id];
            addPhrase(d.persianName);
            addPhrase(d.englishName);
            (d.alternativeNames || []).forEach(addPhrase);
        }
        for (const cmd in COMMANDS) {
            COMMANDS[cmd].triggers.forEach(addPhrase);
        }
        Object.keys(NUMBER_WORDS).forEach(addPhrase);
        Object.keys(PHRASE_MAP).forEach(addPhrase);
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

})(window);
