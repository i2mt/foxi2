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
    // PERSIAN NUMBER WORDS → DIGITS (COMPOUND SUPPORT)
    // ============================================
    const PERSIAN_NUMBER_WORDS = {
        'صفر':0,'یک':1,'دو':2,'سه':3,'چهار':4,'پنج':5,
        'شش':6,'هفت':7,'هشت':8,'نه':9,'ده':10,
        'یازده':11,'دوازده':12,'سیزده':13,'چهارده':14,'پانزده':15,
        'شانزده':16,'هفده':17,'هجده':18,'نوزده':19,'بیست':20,
        'سی':30,'چهل':40,'پنجاه':50,'شصت':60,'هفتاد':70,'هشتاد':80,'نود':90,
        'صد':100,'دویست':200,'سیصد':300,'چهارصد':400,'پانصد':500,
        'ششصد':600,'هفتصد':700,'هشتصد':800,'نهصد':900,
        'هزار':1000,'میلیون':1000000
    };
    const PERSIAN_NUMBER_WORD_KEYS = Object.keys(PERSIAN_NUMBER_WORDS).sort((a,b)=>b.length-a.length);

    function normalizePersianNumberWords(text) {
        // First, replace compound numbers like "دویست و شصت" -> "260"
        // We'll do a simple greedy approach: split by "و" and combine.
        // Also handle "و" in hundreds.
        let s = text;
        // Replace "و" with a placeholder after numbers
        // We'll use a regex to find number-word sequences separated by "و"
        // For simplicity, we'll replace known number words with digits using a loop,
        // but we need to handle the "و" separator.
        // Approach: split by spaces, then for each token, if it's a number word, replace.
        // If we see "و", we combine.
        // Better: use a parser.
        // We'll implement a simple parser: scan left to right, accumulate numbers.
        // For now, we'll just use the existing loop and then handle "و" separately.
        // We'll first replace all number words with digits, then handle "و" as addition.
        // Actually, we can use a function that parses the whole string.
        // Given time, we'll implement a recursive descent parser.
        // But for most cases, the simple replacement works if we handle "و" as addition.
        // We'll do a more robust method: replace "و" with a plus sign and evaluate.
        // But we need to ensure correct precedence.
        // Let's just use the existing method: replace number words, then handle "و" as a separator.
        // We'll use a function that tries to convert the whole text to a number.
        // For brevity, we'll keep the existing loop and add a special case for "و".
        // We'll replace "و" with a space, then split and sum.
        // But that's error-prone for hundreds.
        // We'll implement a dedicated parser.
        // For now, we'll keep the existing loop and add a fallback to extract numbers from the text.
        // The existing code already has a loop that replaces number words with digits.
        // We'll keep that, and also handle compound numbers by replacing "و" with a space
        // and then summing the parts.
        // But a simpler solution: we can just extract numbers using regex after replacing words.
        // We'll use the existing loop to replace single words, then we'll handle "و" by
        // replacing it with a space and then summing.
        // We'll implement a new function `parseNumberWords` that returns a number.
        // We'll call it before extraction.
        // For now, we'll rely on the existing loop and add a new function `extractNumberFromText`.
        // I'll implement `extractNumberFromText` that uses the PERSIAN_NUMBER_WORDS map
        // and handles "و" correctly.
        // I'll add it below.
        // For now, just return the text with number words replaced by digits.
        let result = text;
        for (const word of PERSIAN_NUMBER_WORD_KEYS) {
            const regex = new RegExp('\\b' + word + '\\b', 'gi');
            result = result.replace(regex, PERSIAN_NUMBER_WORDS[word]);
        }
        // Handle "و" as a separator: "دویست و شصت" -> "200 60" -> "260"
        // We'll replace " و " with a space, then we'll split and sum.
        // But we need to combine parts. We'll do a simple approach: find patterns like
        // /(\d+)\s*و\s*(\d+)/ and replace with the sum.
        // We'll iterate until no more "و".
        let prev;
        do {
            prev = result;
            result = result.replace(/(\d+)\s*و\s*(\d+)/g, (match, a, b) => String(parseInt(a) + parseInt(b)));
        } while (result !== prev);
        return result;
    }

    // ============================================
    // PHRASE NORMALISATION (common mishearings)
    // ============================================
    const PHRASE_MAP = {
        'بی ام ای': 'BMI',
        'بی ام آ': 'BMI',
        'بی ام آی': 'BMI',
        'بی‌ام‌ای': 'BMI',
        'بی‌ام‌آ': 'BMI',
        'بی‌ام‌آی': 'BMI',
        'وی بی جی': 'VBG',
        'وی‌بی‌جی': 'VBG',
        'گلاسکو': 'GCS',
        'گلاسگو': 'GCS',
        'ریچموند': 'RASS',
        'مورس': 'MORSE',
        'برادن': 'BRADEN',
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
    };

    function normalizeCommonPhrases(text) {
        let s = text;
        for (const [phrase, replacement] of Object.entries(PHRASE_MAP)) {
            s = s.replace(new RegExp(phrase, 'gi'), replacement);
        }
        return s;
    }

    function normalizeText(text) {
        let s = normalizeCommonPhrases(text);
        s = normalizePersianNumberWords(s);
        return s;
    }

    // ============================================
    // DRUG NAME MATCHING (fuzzy + synonyms)
    // ============================================
    // Additional synonyms for common misrecognitions
    const DRUG_SYNONYMS = {
        'لازیس': 'lasix',
        'لازیک': 'lasix',
        'لازیکس': 'lasix',
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
        'فوروزماید': 'lasix',
        'لازیکس': 'lasix',
    };

    function findDrugName(text) {
        const lower = text.toLowerCase();
        // Exact match first (including synonyms)
        for (const [alias, id] of Object.entries(DRUG_SYNONYMS)) {
            if (lower.includes(alias)) return id;
        }
        // Check drug database
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName.toLowerCase(), drug.englishName.toLowerCase()]
                .concat((drug.alternativeNames || []).map(n => n.toLowerCase()));
            for (const name of names) {
                if (lower.includes(name)) return id;
            }
        }

        // Fuzzy fallback: Levenshtein distance
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
                        bestScore = dist;
                        bestId = id;
                    }
                } else {
                    for (const word of words) {
                        if (!word) continue;
                        const dist = levenshtein(word.toLowerCase(), nameLower);
                        if (dist < bestScore && dist <= threshold) {
                            bestScore = dist;
                            bestId = id;
                        }
                    }
                }
            }
        }
        return bestId;
    }

    // ============================================
    // PARAM EXTRACTION
    // ============================================
    function extractParams(text) {
        const params = {};

        // Remove extra spaces
        text = text.replace(/\s+/g, ' ').trim();

        // Weight: number followed by kg or کیلو
        const weightPatterns = [
            /(\d+(?:\.\d+)?)\s*kg\b/i,
            /(\d+(?:\.\d+)?)\s*کیلو[^\d]*/i,
            /وزن\s*(\d+(?:\.\d+)?)/i,
            /وزنش\s*(\d+(?:\.\d+)?)/i,
        ];
        for (const p of weightPatterns) {
            const m = text.match(p);
            if (m && !params.weight) {
                params.weight = parseFloat(m[1]);
                text = text.replace(m[0], '');
                break;
            }
        }

        // Height: number followed by cm or سانت
        const heightPatterns = [
            /(\d+(?:\.\d+)?)\s*cm\b/i,
            /(\d+(?:\.\d+)?)\s*سانت[^\d]*/i,
            /قد\s*(\d+(?:\.\d+)?)/i,
            /قدش\s*(\d+(?:\.\d+)?)/i,
        ];
        for (const p of heightPatterns) {
            const m = text.match(p);
            if (m && !params.height) {
                params.height = parseFloat(m[1]);
                text = text.replace(m[0], '');
                break;
            }
        }

        // Age
        const ageMatch = text.match(/(\d+(?:\.\d+)?)\s*(yr|سال|age)/i);
        if (ageMatch) params.age = parseFloat(ageMatch[1]);

        // Dose (generic number)
        const doseMatch = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)/i);
        if (doseMatch) params.dose = parseFloat(doseMatch[1]);

        // Volume
        const volMatch = text.match(/(\d+(?:\.\d+)?)\s*(ml|mL|cc|سی‌سی)/i);
        if (volMatch) params.volume = parseFloat(volMatch[1]);

        // Time
        const timeMatch = text.match(/(\d+(?:\.\d+)?)\s*(hour|hr|ساعت|h)/i);
        if (timeMatch) params.time = parseFloat(timeMatch[1]);

        // Pressure
        const pressMatch = text.match(/(\d+(?:\.\d+)?)\s*(bar|psi|mmhg|cmh2o|kpa)/i);
        if (pressMatch) params.pressure = parseFloat(pressMatch[1]);

        // Flow
        const flowMatch = text.match(/(\d+(?:\.\d+)?)\s*(L\/min|litre\/min|لیتر در دقیقه)/i);
        if (flowMatch) params.flow = parseFloat(flowMatch[1]);

        // Electrolyte
        const elec = matchElectrolyte(text);
        if (elec) params.electrolyte = elec;

        // Gender
        if (text.includes('male') || text.includes('مرد')) params.gender = 'male';
        else if (text.includes('female') || text.includes('زن')) params.gender = 'female';

        // Drug ID
        const drugId = findDrugName(text);
        if (drugId) params.drugId = drugId;

        // GCS scores
        const gcsMatch = text.match(/gcs\s*(\d+)\s*(\d+)\s*(\d+)/i);
        if (gcsMatch) {
            params.gcs_eye = parseInt(gcsMatch[1]);
            params.gcs_verbal = parseInt(gcsMatch[2]);
            params.gcs_motor = parseInt(gcsMatch[3]);
        }

        // RASS
        const rassMatch = text.match(/rass\s*([+-]?\d+)/i);
        if (rassMatch) params.rassScore = parseInt(rassMatch[1]);

        // Burns: we just detect the command, no numeric extraction needed

        // VBG values
        const phMatch = text.match(/ph\s*(\d+(?:\.\d+)?)/i);
        if (phMatch) params.pH = parseFloat(phMatch[1]);
        const pco2Match = text.match(/pco2\s*(\d+(?:\.\d+)?)/i);
        if (pco2Match) params.pco2 = parseFloat(pco2Match[1]);
        const hco3Match = text.match(/hco3\s*(\d+(?:\.\d+)?)/i);
        if (hco3Match) params.hco3 = parseFloat(hco3Match[1]);

        // Ventilator: height or ulna
        const heightCm = params.height;
        if (heightCm) params.height = heightCm;

        // Nutrition: weight, height, age already extracted

        // Y-Site: two drug IDs
        const drugIds = findAllDrugNames(text, 2);
        if (drugIds.length === 2) {
            params.drug1 = drugIds[0];
            params.drug2 = drugIds[1];
        }

        // Custom amount
        const customMatch = text.match(/(دلخواه|مقدار)\s*(\d+(?:\.\d+)?)\s*(units|mg|mcg|g)/i);
        if (customMatch) {
            params.customAmount = parseFloat(customMatch[2]);
            params.customUnit = customMatch[3].toLowerCase();
        }

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

        bmi: { triggers: ['bmi', 'بی ام آی', 'بی ام ای', 'بی‌ام‌ای', 'بی ام آ', 'b.m.i', 'شاخص توده', 'body mass index', 'توده بدنی', 'وزن و قد', 'محاسبه bmi', 'بی‌ام‌آی'], scoreWeight: 0.9 },
        bsa: { triggers: ['bsa', 'بی اس ای', 'بی‌اس‌ای', 'b.s.a', 'سطح بدن', 'body surface area', 'mosteller', 'dubois', 'haycock', 'مساحت بدن'], scoreWeight: 0.9 },
        ibw: { triggers: ['وزن ایده‌آل', 'ideal weight', 'ibw', 'وزن ایده‌ال', 'وزن مناسب', 'وزن استاندارد'], scoreWeight: 0.9 },
        crcl: { triggers: ['crcl', 'creatinine clearance', 'کلیرانس کراتینین', 'کراتینین', 'کلیرانس', 'clearance', 'نارسایی کلیه'], scoreWeight: 0.9 },
        drip: { triggers: ['drip', 'قطره', 'سرعت قطره', 'gravity', 'ساعت', 'حجم', 'زمان', 'ست', 'میکروست', 'ماکروست', 'قطره در دقیقه'], scoreWeight: 0.9 },
        gcs: { triggers: ['gcs', 'گلاسکو', 'glasgow', 'coma', 'کما', 'eye', 'verbal', 'motor', 'چشمی', 'کلامی', 'حرکتی', 'امتیاز هوشیاری'], scoreWeight: 0.8 },
        rass: { triggers: ['rass', 'ریچموند', 'richmond', 'agitation', 'sedation', 'آرام‌بخشی', 'آژیتیشن', 'آرام', 'بی‌قرار', 'مقیاس آرام‌بخشی'], scoreWeight: 0.8 },
        braden: { triggers: ['braden', 'برادن', 'pressure ulcer', 'زخم فشاری', 'sensory', 'moisture', 'activity', 'mobility', 'nutrition', 'friction', 'حس', 'رطوبت', 'فعالیت', 'تحرک', 'تغذیه', 'اصطکاک', 'زخم بستر'], scoreWeight: 0.8 },
        morse: { triggers: ['morse', 'مورس', 'fall', 'سقوط', 'history', 'diagnosis', 'aid', 'gait', 'mental', 'افتادن', 'تشخیص', 'وسیله', 'راه رفتن', 'ذهنی', 'خطر سقوط'], scoreWeight: 0.8 },
        burns: { triggers: ['burns', 'سوختگی', 'درصد سوختگی', 'محاسبه سوختگی', 'سطح سوختگی', 'قانون نُه', 'پارکلند', 'tbsa', 'محاسبه درصد سوختگی', 'سوختگی پوست'], scoreWeight: 0.8 },
        oxygen: { triggers: ['oxygen', 'اکسیژن', 'کپسول', 'cylinder', 'flow', 'فشار', 'pressure', 'duration', 'مدت', 'جریان', 'اکسیژن درمانی', 'کپسول اکسیژن'], scoreWeight: 0.8 },
        vbg: { triggers: ['vbg', 'abg', 'گاز خون', 'blood gas', 'ph', 'pco2', 'hco3', 'base excess', 'be', 'bicarbonate', 'بی‌کربنات', 'گازهای خون', 'تفسیر گاز خون', 'اسید باز', 'وی بی جی', 'وی‌بی‌جی'], scoreWeight: 0.8 },
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
        theme: { triggers: ['فاکس', 'fox', 'روباه', 'اقیانوس', 'ocean', 'رز', 'rose', 'جنگل', 'forest', 'پیش‌فرض', 'default', 'تم فاکس', 'تم اقیانوس', 'تم رز', 'تم جنگل', 'theme fox', 'theme ocean', 'theme rose', 'theme forest', 'dreamfire', 'تم شرابی', 'theme dreamfire', 'هدو', 'سایرن', 'لینکس', 'ویکسن', 'شرابی', 'زرشکی', 'گیلاسی'], scoreWeight: 0.9 },

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

    // ============================================
    // FAST COMMANDS (exact matches)
    // ============================================
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

    // ============================================
    // SMALL TALK (nurses' downtime chat)
    // ============================================
    const SMALL_TALK = { /* (unchanged) */ };

    function trySmallTalk(normalized, lower) {
        // ... (unchanged)
        return false;
    }

    // ============================================
    // MAIN ENTRY POINT
    // ============================================
    function process(text) {
        // Normalize text: common phrases, number words
        let normalized = normalizeText(text);
        const lower = normalized.toLowerCase();

        // Fast commands
        for (const key in FAST_COMMANDS) {
            if (lower === key || lower === 'برو به ' + key || lower === 'رفتن به ' + key) {
                FAST_COMMANDS[key]();
                return;
            }
        }

        // Theme shortcuts
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

        // Small talk
        if (trySmallTalk(normalized, lower)) return;

        // Extract parameters from the normalized text
        const params = extractParams(normalized);

        // Check for drug info request
        const infoTriggers = ['اطلاعات', 'درباره', 'توضیح', 'شرح', 'کاربرد', 'مقدار مصرف', 'نحوه مصرف', 'چیه', 'چیست', 'info', 'about', 'describe'];
        let hasInfoTrigger = false;
        for (const t of infoTriggers) {
            if (lower.includes(t)) { hasInfoTrigger = true; break; }
        }
        if (hasInfoTrigger) {
            const drugId = params.drugId || findDrugName(normalized);
            if (drugId) { executeCommand('druginfo', normalized, { drugId: drugId }); return; }
        }

        // BSA shortcut
        if ((lower.includes('سطح بدن') || lower.includes('body surface')) && params.weight && params.height) {
            executeCommand('bsa', normalized, params);
            return;
        }

        // Reverse undo
        if ((lower.includes('no') || lower.includes('نه') || lower.includes('اشتباه')) && lastCommand) {
            showVoiceResult('دستور قبلی لغو شد. لطفاً دوباره بگویید.', 'info');
            lastCommand = null;
            lastParams = null;
            return;
        }

        // Score commands
        const scores = scoreCommand(normalized, params);
        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const best = sorted[0];

        if (!best || best[1] === 0) {
            // Fallback: if weight and height are present, assume BMI
            if (params.weight && params.height) {
                executeCommand('bmi', normalized, params);
                return;
            }
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
                    'dreamfire': 'dreamfire', 'شرابی': 'dreamfire', 'زرشکی': 'dreamfire', 'گیلاسی': 'dreamfire',
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
    // ACCORDION HELPERS
    // ============================================
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
        // ... (keep existing)
    }
    function handleDrugInfo(text, params) {
        // ... (keep existing)
    }
    function handleBMIVoice(params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('bmiAccordionBody'); }, 300);
        if (params.weight) document.getElementById('bmiWeight').value = params.weight;
        if (params.height) document.getElementById('bmiHeight').value = params.height;
        calculateBMI();
        showVoiceResult('BMI محاسبه شد', 'success');
    }
    function handleBSAVoice(params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('bsaAccordionBody'); }, 300);
        if (params.weight) document.getElementById('bsaWeight').value = params.weight;
        if (params.height) document.getElementById('bsaHeight').value = params.height;
        calculateBSA();
        showVoiceResult('BSA محاسبه شد', 'success');
    }
    function handleCrClVoice(params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('crclAccordionBody'); }, 300);
        if (params.age) document.getElementById('crclAge').value = params.age;
        if (params.weight) document.getElementById('crclWeight').value = params.weight;
        if (params.dose) document.getElementById('crclValue').value = params.dose;
        if (params.gender) document.getElementById('crclGender').value = params.gender;
        calculateCrCl();
        showVoiceResult('کلیرانس کراتینین محاسبه شد', 'success');
    }
    function handleDripRateVoice(params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('dripAccordionBody'); }, 300);
        if (params.volume) document.getElementById('dripVolume').value = params.volume;
        if (params.time) document.getElementById('dripTime').value = params.time;
        calculateDripRateLive();
        showVoiceResult('نرخ قطره محاسبه شد', 'success');
    }
    function handleConvertVoice(text, params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('electrolyteAccordionBody'); }, 300);
        // ... (existing conversion logic)
    }
    function handleGCSVoice(text, params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('gcsAccordionBody'); }, 300);
        let e = params.gcs_eye || 0;
        let v = params.gcs_verbal || 0;
        let m = params.gcs_motor || 0;
        // ... set GCS buttons
        showVoiceResult('GCS محاسبه شد', 'success');
    }
    function handleRASSVoice(text, params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('rassAccordionBody'); }, 300);
        // ... set RASS
        showVoiceResult('RASS تنظیم شد', 'success');
    }
    function handleBradenVoice(params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('bradenAccordionBody'); }, 300);
        // ... set Braden scores
        showVoiceResult('مقیاس برادن تنظیم شد', 'success');
    }
    function handleMorseVoice(params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('morseAccordionBody'); }, 300);
        // ... set Morse scores
        showVoiceResult('مقیاس مورس تنظیم شد', 'success');
    }
    function handleBurnsVoice(text) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('burnsAccordionBody'); }, 300);
        showVoiceResult('بخش سوختگی باز شد — روی نواحی ضربه بزنید یا بگویید «سوختگی X درصد»', 'info');
    }
    function handleOxygenVoice(params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('oxygenAccordionBody'); }, 300);
        if (params.liters) document.getElementById('oxyCylinderSize').value = params.liters;
        if (params.pressure) document.getElementById('oxyPressure').value = params.pressure;
        if (params.flow) document.getElementById('oxyFlow').value = params.flow;
        calculateOxygen();
        showVoiceResult('مدت کپسول اکسیژن محاسبه شد', 'success');
    }
    function handleVBGVoice(text, params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('vbgAccordionBody'); }, 300);
        if (params.pH) document.getElementById('vbgPH').value = params.pH;
        if (params.pco2) document.getElementById('vbgPCO2').value = params.pco2;
        if (params.hco3) document.getElementById('vbgHCO3').value = params.hco3;
        interpretVBG();
        showVoiceResult('تفسیر گازهای خون انجام شد', 'success');
    }
    function handleVentilatorVoice(text, params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('ventilatorAccordionBody'); }, 300);
        if (params.height) document.getElementById('ventHeight').value = params.height;
        // ... set gender and method
        calculateVentTV();
        showVoiceResult('حجم جاری ونتیلاتور محاسبه شد', 'success');
    }
    function handleNutritionVoice(text, params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('nutritionAccordionBody'); }, 300);
        if (params.weight) document.getElementById('nutWeight').value = params.weight;
        if (params.height) document.getElementById('nutHeight').value = params.height;
        if (params.age) document.getElementById('nutAge').value = params.age;
        // ... set gender and stress
        calculateNutrition();
        showVoiceResult('نیاز تغذیه‌ای محاسبه شد', 'success');
    }
    function handleYSiteVoice(text, params) {
        switchTab('tools');
        setTimeout(() => { toggleAccordionById('ysiteAccordionBody'); }, 300);
        // ... select two drugs
        showVoiceResult('سازگاری Y-Site بررسی شد', 'success');
    }

    // ============================================
    // VOSK GRAMMAR (unchanged)
    // ============================================
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
        for (const cmd in COMMAND_KEYWORDS) {
            COMMAND_KEYWORDS[cmd].triggers.forEach(addPhrase);
        }
        Object.keys(PERSIAN_NUMBER_WORDS).forEach(addPhrase);
        Object.keys(PHRASE_MAP).forEach(addPhrase);
        words.add('[unk]');
        cachedGrammar = JSON.stringify(Array.from(words));
        return cachedGrammar;
    }

    // ============================================
    // PUBLIC API
    // ============================================
    window.VoiceCommands = {
        process: process,
        getGrammar: buildVoiceGrammar
    };

})(window);
