/* ============================================
   FoxiMed — Voice Commands (Strict Drug Match + Dose Fix)
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
        const phraseMap = {
            'بی ام ای':'bmi','بی ام آ':'bmi','بی ام آی':'bmi',
            'بی‌ام‌ای':'bmi','بی‌ام‌آ':'bmi','بی‌ام‌آی':'bmi',
            'بی اس ای':'bsa','بی‌اس‌ای':'bsa','سطح بدن':'bsa',
            'گلاسکو':'gcs','گلاسگو':'gcs',
            'ریچموند':'rass',
            'وی بی جی':'vbg','وی‌بی‌جی':'vbg','گاز خون':'vbg',
            'سوختگی':'burns','درصد سوختگی':'burns','محاسبه سوختگی':'burns',
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
        for (const word of NUMBER_KEYS) {
            const regex = new RegExp('\\b' + word + '\\b', 'gi');
            s = s.replace(regex, NUMBER_WORDS[word]);
        }
        let prev;
        do {
            prev = s;
            s = s.replace(/(\d+)\s*و\s*(\d+)/g, (match, a, b) => String(parseInt(a) + parseInt(b)));
        } while (s !== prev);
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }

    // ------------------------------------------------------------
    // DRUG NAME MATCHING (STRICT)
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
        // 1. Exact match (whole word or substring)
        for (const [alias, id] of Object.entries(DRUG_SYNONYMS)) {
            const regex = new RegExp('\\b' + alias + '\\b', 'i');
            if (regex.test(text)) return id;
        }
        if (typeof drugDatabase === 'undefined' || !drugDatabase) {
            return null;
        }
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName, drug.englishName].concat(drug.alternativeNames || []);
            for (const name of names) {
                const regex = new RegExp('\\b' + name + '\\b', 'i');
                if (regex.test(text)) return id;
            }
        }

        // 2. Strict fuzzy: only allow if edit distance <= 1 (typo)
        const words = text.split(/\s+/);
        let bestId = null;
        let bestScore = Infinity;
        const threshold = 1; // Only 1-character difference allowed
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName, drug.englishName].concat(drug.alternativeNames || []);
            for (const name of names) {
                const nameLower = name.toLowerCase();
                // Ignore very short names (2 chars or less) to avoid false matches
                if (nameLower.length < 3) continue;
                if (nameLower.includes(' ')) {
                    const dist = levenshtein(lower, nameLower);
                    if (dist < bestScore && dist <= threshold) {
                        bestScore = dist; bestId = id;
                    }
                } else {
                    for (const word of words) {
                        if (!word || word.length < 2) continue;
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
        // Exact matches first
        for (const [alias, id] of Object.entries(DRUG_SYNONYMS)) {
            const regex = new RegExp('\\b' + alias + '\\b', 'i');
            if (regex.test(text) && !found.includes(id)) {
                found.push(id);
                if (found.length >= limit) return found;
            }
        }
        if (typeof drugDatabase === 'undefined') return found;
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName, drug.englishName].concat(drug.alternativeNames || []);
            for (const name of names) {
                const regex = new RegExp('\\b' + name + '\\b', 'i');
                if (regex.test(text) && !found.includes(id)) {
                    found.push(id);
                    if (found.length >= limit) return found;
                }
            }
        }
        // No fuzzy for Y-Site – must be exact
        return found;
    }

    // ------------------------------------------------------------
    // PARAMETER EXTRACTION (Enhanced Dose)
    // ------------------------------------------------------------
    function extractParams(text) {
        const params = {};
        const raw = text;
        const s = normalizeText(text);
        console.log('[Voice] normalizeText output:', s);

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
        const ageMatch = s.match(/(\d+(?:\.\d+)?)\s*(yr|سال|age)\b/i);
        if (ageMatch) params.age = parseFloat(ageMatch[1]);

        // --- Dose (primary) ---
        // Pattern 1: number with explicit unit (mg, mcg, g, units, "واحد")
        let doseMatch = s.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units|واحد)\b/i);
        if (doseMatch) {
            params.dose = parseFloat(doseMatch[1]);
            params.doseUnit = doseMatch[2].toLowerCase();
        } else {
            // Pattern 2: number followed by "دوز" or "مقدار"
            const doseContext = s.match(/(\d+(?:\.\d+)?)\s*(دوز|مقدار)/i);
            if (doseContext) {
                params.dose = parseFloat(doseContext[1]);
            } else {
                // Pattern 3: any standalone number if a drug name is present
                const drugId = findDrugName(s);
                if (drugId) {
                    const numMatch = s.match(/(\d+(?:\.\d+)?)/);
                    if (numMatch) params.dose = parseFloat(numMatch[1]);
                }
            }
        }

        // If still no dose, try raw text (before normalization)
        if (!params.dose || params.dose <= 0) {
            const rawNum = raw.match(/\d+(?:\.\d+)?/);
            if (rawNum) params.dose = parseFloat(rawNum[0]);
        }

        console.log('[Voice] Extracted dose:', params.dose);

        // Volume
        const volMatch = s.match(/(\d+(?:\.\d+)?)\s*(ml|mL|cc|سی‌سی)\b/i);
        if (volMatch) params.volume = parseFloat(volMatch[1]);

        // Time
        const timeMatch = s.match(/(\d+(?:\.\d+)?)\s*(hour|hr|ساعت|h)\b/i);
        if (timeMatch) params.time = parseFloat(timeMatch[1]);

        // Pressure
        const pressMatch = s.match(/(\d+(?:\.\d+)?)\s*(bar|psi|mmhg|cmh2o|kpa)\b/i);
        if (pressMatch) params.pressure = parseFloat(pressMatch[1]);

        // Flow
        const flowMatch = s.match(/(\d+(?:\.\d+)?)\s*(L\/min|litre\/min|لیتر در دقیقه)\b/i);
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

        // Drug ID (strict)
        const drugId = findDrugName(s);
        if (drugId) params.drugId = drugId;

        // Y-Site (exact only)
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
        const oxySize = s.match(/(\d+(?:\.\d+)?)\s*(L|لیتر)\b/i);
        if (oxySize) params.liters = parseFloat(oxySize[1]);
        if (!params.liters && /oxygen|اکسیژن|کپسول/.test(s)) {
            const num = s.match(/(\d+(?:\.\d+)?)/);
            if (num) params.liters = parseFloat(num[1]);
        }
        if (!params.flow) {
            const flow2 = s.match(/(\d+(?:\.\d+)?)\s*(L\/min|لیتر)/i);
            if (flow2) params.flow = parseFloat(flow2[1]);
        }
        if (!params.pressure) {
            const press2 = s.match(/(\d+(?:\.\d+)?)\s*(bar|بار)/i);
            if (press2) params.pressure = parseFloat(press2[1]);
        }

        params._original = text;
        params._normalized = s;
        return params;
    }

    // ------------------------------------------------------------
    // COMMAND TRIGGERS (same as balanced)
    // ------------------------------------------------------------
    const COMMAND_TRIGGERS = {
        tab_calculator: ['ماشین حساب', 'calculator', 'محاسبه'],
        tab_drugs: ['مرجع داروها', 'کتابخانه دارو', 'لیست داروها', 'داروخانه', 'drug library'],
        tab_tools: ['ابزارها', 'ابزار', 'tools'],
        clear: ['پاک کن', 'پاک کردن', 'صفر', 'clear', 'reset', 'پاکسازی'],
        manual_calc: ['دستی', 'manual', 'بدون دارو', 'دلخواه'],
        history: ['تاریخچه', 'history', 'سابقه', 'گزارش'],
        reverse: ['معکوس', 'reverse', 'برعکس', 'وارونه'],
        bmi: ['bmi', 'بی ام ای', 'بی‌ام‌ای', 'شاخص توده', 'body mass index', 'وزن و قد', 'محاسبه bmi'],
        bsa: ['bsa', 'بی اس ای', 'سطح بدن', 'body surface area', 'mosteller', 'محاسبه bsa'],
        ibw: ['وزن ایده‌آل', 'ideal weight', 'ibw', 'وزن استاندارد', 'وزن ایده ال'],
        crcl: ['crcl', 'کلیرانس کراتینین', 'creatinine clearance', 'کراتینین', 'clearance'],
        drip: ['drip', 'قطره', 'سرعت قطره', 'gravity', 'قطره در دقیقه', 'محاسبه قطره'],
        gcs: ['gcs', 'گلاسکو', 'glasgow', 'کما', 'گلاسکو کما'],
        rass: ['rass', 'ریچموند', 'richmond', 'آرام‌بخشی', 'آژیتیشن', 'مقیاس راس'],
        braden: ['braden', 'برادن', 'زخم فشاری', 'pressure ulcer', 'مقیاس برادن'],
        morse: ['morse', 'مورس', 'سقوط', 'fall', 'خطر سقوط'],
        burns: ['burns', 'سوختگی', 'درصد سوختگی', 'tbsa', 'قانون نُه', 'پارکلند', 'محاسبه سوختگی', 'درصد سوختگی'],
        oxygen: ['oxygen', 'اکسیژن', 'کپسول', 'cylinder', 'جریان', 'فشار', 'مدت اکسیژن', 'کپسول اکسیژن'],
        vbg: ['vbg', 'وی بی جی', 'گاز خون', 'blood gas', 'ph', 'pco2', 'hco3', 'اسید باز', 'تفسیر گاز'],
        ventilator: ['ventilator', 'ونتیلاتور', 'حجم جاری', 'tidal volume', 'pbw', 'ards', 'تهویه'],
        nutrition: ['nutrition', 'تغذیه', 'کالری', 'calories', 'protein', 'پروتئین', 'bmr', 'نیاز کالری'],
        convert: ['convert', 'تبدیل', 'meq', 'میلی‌اکی‌والان', 'الکترولیت'],
        electrolyte: ['الکترولیت', 'تبدیل الکترولیت', 'سدیم', 'پتاسیم', 'کلسیم', 'منیزیم', 'بی‌کربنات'],
        percentage: ['درصد', 'غلظت درصد', 'percentage solution', 'محلول درصدی'],
        unit_convert: ['تبدیل واحد', 'واحد', 'میکروگرم', 'میلی‌گرم', 'gram', 'unit conversion'],
        temp_convert: ['تبدیل دما', 'درجه', 'سلسیوس', 'فارنهایت', 'temperature'],
        weight_convert: ['تبدیل وزن', 'کیلوگرم', 'پوند', 'گرم', 'weight conversion'],
        drug: ['دوز', 'انفوزیون', 'تزریق', 'پمپ', 'سرنگ', 'میکروگرم', 'میلی‌گرم', 'واحد', 'kg/h', 'mcg', 'mg', 'units', 'میلی‌لیتر', 'سی‌سی', 'حجم', 'محلول', 'آمپول', 'ویال'],
        druginfo: ['دارو', 'اطلاعات', 'درباره', 'توضیح', 'شرح', 'کاربرد', 'مقدار مصرف', 'نحوه مصرف', 'چیه', 'چیست', 'info', 'about', 'describe'],
        dose_calc: ['دوز', 'حجم ویال', 'dose calculation', 'vial', 'حجم تزریقی'],
        compat_tool: ['سازگاری', 'compatibility', 'تداخل دارویی', 'ysite', 'y-site', 'مخلوط'],
        ysite: ['ysite', 'y-site', 'سازگاری', 'تداخل', 'مخلوط', 'همزمان'],
        settings: ['تنظیمات', 'settings', 'dark mode', 'light mode', 'تاریک', 'روشن', 'دارک', 'لایت', 'فونت بزرگ', 'فونت کوچک'],
        theme: ['تم', 'theme', 'فاکس', 'fox', 'روباه', 'اقیانوس', 'ocean', 'رز', 'rose', 'جنگل', 'forest', 'dreamfire', 'شرابی'],
        help: ['help', 'راهنما', 'کمک', 'نمونه', 'example', 'چه کارایی', 'راهنمایی']
    };

    // ------------------------------------------------------------
    // SCORING (balanced)
    // ------------------------------------------------------------
    function scoreCommand(text, params) {
        const lower = text.toLowerCase();
        const scores = {};

        for (const [cmd, triggers] of Object.entries(COMMAND_TRIGGERS)) {
            let score = 0;
            for (const trigger of triggers) {
                if (fuzzyMatch(lower, trigger, 2)) {
                    score += 1;
                }
            }
            scores[cmd] = score;
        }

        // Contextual boosts
        if (params.drugId) {
            scores['drug'] = (scores['drug'] || 0) + 4;
            scores['druginfo'] = (scores['druginfo'] || 0) + 3;
        }

        if (params.weight && params.height) {
            if (scores['bmi'] > 0) scores['bmi'] += 3;
            if (scores['bsa'] > 0) scores['bsa'] += 3;
        }
        if (params.age && params.weight && params.dose) {
            if (scores['crcl'] > 0) scores['crcl'] += 3;
        }
        if (params.volume && params.time) {
            if (scores['drip'] > 0) scores['drip'] += 3;
        }
        if (params.gcs_eye || params.gcs_verbal || params.gcs_motor) {
            if (scores['gcs'] > 0) scores['gcs'] += 3;
        }
        if (params.rassScore !== undefined) {
            if (scores['rass'] > 0) scores['rass'] += 3;
        }
        if (params.burnPercent !== undefined) {
            if (scores['burns'] > 0) scores['burns'] += 3;
        }
        if (params.pH && params.pco2 && params.hco3) {
            if (scores['vbg'] > 0) scores['vbg'] += 3;
        }
        if (params.height) {
            if (scores['ventilator'] > 0) scores['ventilator'] += 3;
        }
        if (params.weight || params.height || params.age) {
            if (scores['nutrition'] > 0) scores['nutrition'] += 3;
        }
        if (params.drug1 && params.drug2) {
            if (scores['ysite'] > 0) scores['ysite'] += 3;
        }
        if (params.liters || params.pressure || params.flow) {
            if (scores['oxygen'] > 0) scores['oxygen'] += 3;
        }

        // Direct tool name mention
        const toolNames = ['bmi','bsa','ibw','crcl','drip','gcs','rass','braden','morse','burns','oxygen','vbg','ventilator','nutrition'];
        for (const t of toolNames) {
            if (scores[t] > 0 && fuzzyMatch(lower, t, 1)) {
                scores[t] += 2;
            }
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
            } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
        },
        'روشن': function () {
            try {
                AppState.settings.themeMode = 'light';
                if (typeof saveSettings === 'function') saveSettings();
                if (typeof applyThemeMode === 'function') applyThemeMode();
                showVoiceResult('حالت روشن فعال شد', 'success');
            } catch (e) { showVoiceResult('خطا: ' + e.message, 'error'); }
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
    // SMALL TALK (condensed)
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
    // RESULT DISPLAY
    // ------------------------------------------------------------
    function showVoiceResult(message, type) {
        try {
            if (window.VoiceUI && typeof window.VoiceUI.showResult === 'function') {
                window.VoiceUI.showResult(message, type || 'success');
            } else if (typeof showToast === 'function') {
                showToast(type || 'info', message);
            } else {
                console.log('[Voice]', message);
            }
        } catch (e) {
            console.error('[Voice] showVoiceResult error:', e);
        }
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

            // Theme shortcuts
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

            // ---- DIRECT SHORTCUTS ----
            // Force burns if "سوختگی" or "درصد سوختگی" appears (even if drug matched)
            if (lower.includes('سوختگی') || lower.includes('درصد سوختگی')) {
                executeCommand('burns', normalized, params);
                return;
            }

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

            // If oxygen parameters present, default to oxygen
            if (params.liters || params.pressure || params.flow) {
                executeCommand('oxygen', normalized, params);
                return;
            }

            // If height present and ventilator mentioned, default to ventilator
            if (params.height && (lower.includes('ventilator') || lower.includes('ونتیلاتور') || lower.includes('حجم جاری'))) {
                executeCommand('ventilator', normalized, params);
                return;
            }

            // If weight/height/age present and nutrition mentioned, default to nutrition
            if ((params.weight || params.height || params.age) && (lower.includes('nutrition') || lower.includes('تغذیه') || lower.includes('کالری'))) {
                executeCommand('nutrition', normalized, params);
                return;
            }

            // ---- Score commands ----
            const scores = scoreCommand(normalized, params);
            console.log('[Voice] Scores:', scores);
            const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
            const best = sorted[0];
            console.log('[Voice] Best command:', best);

            if (!best || best[1] === 0) {
                if (params.drugId && params.dose) {
                    executeCommand('drug', normalized, params);
                    return;
                }
                if (params.drugId) {
                    executeCommand('druginfo', normalized, params);
                    return;
                }
                // Fallback: try to match a tool name directly
                for (const [cmd, triggers] of Object.entries(COMMAND_TRIGGERS)) {
                    if (['bmi','bsa','ibw','crcl','drip','gcs','rass','braden','morse','burns','oxygen','vbg','ventilator','nutrition'].includes(cmd)) {
                        for (const trigger of triggers) {
                            if (lower.includes(trigger.toLowerCase())) {
                                executeCommand(cmd, normalized, params);
                                return;
                            }
                        }
                    }
                }
                showVoiceResult('متوجه نشدم. لطفاً واضح‌تر بگویید یا از دکمه‌های نمونه استفاده کنید.', 'error');
                return;
            }

            // Confirmation if scores are very close (within 1 point)
            const second = sorted[1];
            if (second && (best[1] - second[1]) <= 1) {
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
    // SAFE CALL HELPER
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

    // ------------------------------------------------------------
    // TOOL HANDLERS
    // ------------------------------------------------------------
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
    // DRUG HANDLERS (with robust dose setting)
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

            // ---- Method ----
            if (params.method) {
                document.querySelectorAll('.method-btn-compact').forEach(btn => {
                    if (btn.dataset.method === params.method) btn.click();
                });
            }

            // ---- Volume ----
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

            // ---- Ampoules ----
            if (params.ampoules) {
                AppState.ampouleCount = Math.max(1, params.ampoules);
                if (typeof updateAmpouleInfo === 'function') updateAmpouleInfo();
                const ampDisplay = document.getElementById('ampouleCount');
                if (ampDisplay) ampDisplay.textContent = AppState.ampouleCount;
            }

            // ---- Custom amount ----
            if (params.customAmount !== undefined && params.customUnit) {
                const isInsulin = drug.id === 'insulin';
                if (!isInsulin && DOM.customAmountToggleClickRow) DOM.customAmountToggleClickRow.click();
                if (DOM.customAmountInput) {
                    DOM.customAmountInput.value = params.customAmount;
                    DOM.customAmountInput.dataset.numericValue = params.customAmount;
                }
            }

            // ---- Weight ----
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

            // ---- Dose (extract again from raw text) ----
            let doseVal = params.dose || null;
            if (!doseVal || doseVal <= 0) {
                const rawNum = text.match(/\d+(?:\.\d+)?/);
                if (rawNum) doseVal = parseFloat(rawNum[0]);
            }
            if (!doseVal || doseVal <= 0) {
                const unitMatch = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units|واحد)/i);
                if (unitMatch) doseVal = parseFloat(unitMatch[1]);
            }

            console.log('[Voice] Final dose to set:', doseVal);

            if (doseVal !== null && doseVal > 0) {
                if (DOM.doctorOrder) {
                    DOM.doctorOrder.value = doseVal;
                    DOM.doctorOrder.dataset.numericValue = doseVal;
                }
            } else {
                showVoiceResult('دوز مشخص نشد. لطفاً مقدار دوز را وارد کنید.', 'warning');
            }

            // ---- Switch to calculator and calculate ----
            if (AppState.currentTab !== 'calculator' && typeof switchTab === 'function') switchTab('calculator');
            if (typeof updateDoseRangeIndicator === 'function') updateDoseRangeIndicator();
            if (AppState.reverseMode) {
                if (typeof calculateReverse === 'function') calculateReverse();
            } else {
                if (typeof calculateInfusion === 'function') calculateInfusion();
            }
            // If dose was set, ensure it's still there after calculation (some functions may reset)
            if (doseVal && DOM.doctorOrder) {
                DOM.doctorOrder.value = doseVal;
                DOM.doctorOrder.dataset.numericValue = doseVal;
            }

            setTimeout(() => {
                const results = document.getElementById('resultsSection');
                if (results && results.style.display === 'block') {
                    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 300);

            if (doseVal) {
                showVoiceResult('محاسبه ' + drug.persianName + ' با دوز ' + doseVal + ' انجام شد.', 'success');
            } else {
                showVoiceResult('محاسبه ' + drug.persianName + ' باز شد. دوز را وارد کنید.', 'info');
            }
        } catch (e) {
            console.error('[Voice] Drug handler error:', e);
            showVoiceResult('خطا در محاسبه دارو: ' + e.message, 'error');
        }
    }

    // ------------------------------------------------------------
    // DRUG INFO HANDLER
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // THEME HANDLER
    // ------------------------------------------------------------
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
        for (const cmd in COMMAND_TRIGGERS) {
            COMMAND_TRIGGERS[cmd].forEach(addPhrase);
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
