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

   © Mohammad Mahdi Taghavi — FoxiMed
   ============================================ */
(function (window) {
    'use strict';

    let lastCommand = null;
    let lastParams = null;
    let confirmationSequence = 0;
    let creatorContactFollowupUntil = 0;

    function showVoiceResult(message, type) {
        if (window.VoiceUI && typeof window.VoiceUI.showResult === 'function') {
            window.VoiceUI.showResult(message, type || 'success');
        }
    }

    function normalizeTranscript(text) {
        return String(text || '')
            .replace(/[يى]/g, 'ی')
            .replace(/ك/g, 'ک')
            .replace(/[ۀة]/g, 'ه')
            .replace(/[ؤ]/g, 'و')
            .replace(/[إأ]/g, 'ا')
            .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
            .replace(/\u200c/g, ' ')
            .replace(/[,،؛;؟?!:«»"“”'`()\[\]{}]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Persian ASR models usually write spoken Latin acronyms phonetically
    // ("بی ام آی") rather than returning ASCII ("BMI"). Normalize only
    // well-known clinical acronyms, with token boundaries, before number
    // conversion/scoring. This also prevents the letter name "سی" inside
    // GCS/CrCl from being mistaken for the number thirty.
    const SPOKEN_CLINICAL_ACRONYMS = [
        { pattern: /(^|\s)(?:بی\s*(?:ام|m)\s*(?:آی|ای|ایی|عای|i)|بی\s*mi|b\s*m\s*i|بیامای)(?=\s|$)/gi, value: 'bmi' },
        { pattern: /(^|\s)(?:بی\s*اس\s*(?:ای|آی|آ)|بیاسای)(?=\s|$)/g, value: 'bsa' },
        { pattern: /(^|\s)(?:جی\s*سی\s*اس|جیسیاس|جی\s*سیاس)(?=\s|$)/g, value: 'gcs' },
        { pattern: /(^|\s)(?:آر\s*(?:ای\s*)?اس\s*اس|آراس\s*اس)(?=\s|$)/g, value: 'rass' },
        { pattern: /(^|\s)(?:ای\s*بی\s*جی|ایبیجی)(?=\s|$)/g, value: 'abg' },
        { pattern: /(^|\s)(?:وی\s*بی\s*جی|ویبیجی)(?=\s|$)/g, value: 'vbg' },
        { pattern: /(^|\s)(?:سی\s*آر\s*سی\s*ال|سی\s*آر\s*کل)(?=\s|$)/g, value: 'crcl' },
        { pattern: /(^|\s)(?:تی\s*بی\s*اس\s*(?:ای|آی)|تیبیاسای)(?=\s|$)/g, value: 'tbsa' },
        { pattern: /(^|\s)(?:تی\s*ان\s*جی|تیانجی|تی\s*انجی)(?=\s|$)/g, value: 'tng' }
    ];

    function normalizeSpokenClinicalTerms(text) {
        let result = text;
        SPOKEN_CLINICAL_ACRONYMS.forEach(function (item) {
            result = result.replace(item.pattern, function (_, lead) {
                return (lead || '') + item.value;
            });
        });
        // Curated corrections from real FoxiMed transcripts. Keep these
        // exact-token and evidence-based: broad autocorrection of drug
        // fragments would be unsafe. Drug commands still require the user
        // to confirm the canonical interpretation before execution.
        result = result
            .replace(/(^|\s)(?:امفزیون|انفوزیون)تی\s*انجی(?=\s|$)/g, '$1انفوزیون tng')
            .replace(/(^|\s)(?:چندفزیون|چندفزیان|انفزیون|انفوزن|هموزیان|امزیون|امفزیان|امفزیون|امفوزیان|امپوزیان|امپزیون|امپزیان|همپزیان)(?=\s|$)/g, '$1انفوزیون')
            .replace(/(^|\s)من\s+فزیون(?=\s|$)/g, '$1انفوزیون')
            .replace(/(^|\s)من\s+پزیون(?=\s|$)/g, '$1انفوزیون')
            .replace(/(^|\s)(?:هپار|هپاری)(?=\s|$)/g, '$1هپارین')
            .replace(/(^|\s)(?:میادوللان|میادولان|میدازوللان)(?=\s|$)/g, '$1میدازولام')
            .replace(/(^|\s)فانیل(?=\s|$)/g, '$1فنتانیل')
            .replace(/(^|\s)فزماید(?=\s|$)/g, '$1فوروزماید')
            .replace(/(^|\s)می\s+میرم(?=\s|$)/g, '$1میلی گرم')
            .replace(/(^|\s)در\s+دقیقا(?=\s|$)/g, '$1در دقیقه')
            .replace(/(^|\s)میکروس(?=\s|$)/g, '$1میکروست')
            .replace(/(^|\s)اکتوت\s+تاید(?=\s|$)/g, '$1اکترئوتاید')
            .replace(/(^|\s)دوپامامی(?=\s|$)/g, '$1دوپامین')
            .replace(/(^|\s)(?:آامیاد\s+داران|عامیه\s+دارون)(?=\s|$)/g, '$1آمیودارون')
            .replace(/(^|\s)(?:پ\s+و\s+پروزو|پتو\s+پروراول)(?=\s|$)/g, '$1پنتوپرازول');

        if (/(?:^|\s)یه\s+مای(?=\s|$)/.test(result) && /(?:قد|وزن)/.test(result)) {
            result = result.replace(/(^|\s)یه\s+مای(?=\s|$)/g, '$1bmi');
        }
        if (result.includes('انسولین')) {
            result = result.replace(/(^|\s)(?:رگووللا|رگولایژ)(?=\s|$)/g, '$1رگولار');
        }
        return result.replace(/\s+/g, ' ').trim();
    }

    // Conservative recovery for short, non-clinical Persian phrases seen in
    // real ASR output. A model may split a word or choose a common homophonic
    // spelling. Keep this separate from
    // clinical-term recovery so these friendly phrases can never rewrite a
    // drug name, dose, number or confirmation transcript.
    function normalizeConversationalAsr(text) {
        return text
            .replace(/(^|\s)سالا\s+امهال\s+اچتوره(?=\s|$)/g, '$1سلام حالت چطوره')
            .replace(/(^|\s)سالام\s+هل\s+چیث\s+ره(?=\s|$)/g, '$1سلام حالت چطوره')
            .replace(/(^|\s)حو\s+بی(?=\s|$)/g, '$1خوبی')
            .replace(/(^|\s)(?:خیده\s+هستا|گیدگستا)(?=\s|$)/g, '$1خیلی خسته ام')
            .replace(/(^|\s)سالام(?=\s|$)/g, '$1سلام')
            .replace(/(^|\s)ا?چتوره(?=\s|$)/g, '$1چطوره')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ============================================
    // CONTEXTUAL TIPS (shown after a successful command)
    // ============================================
    const TIPS = {
        bmi: 'نکته: برای محاسبه سطح بدن بگویید «سطح بدن، وزن ۷۰، قد ۱۷۰».',
        bsa: 'نکته: برای BMI بگویید «شاخص توده بدنی، وزن ۷۵، قد ۱۷۵».',
        crcl: 'نکته: جنسیت رو هم می‌تونی بگی: «زن» یا «مرد».',
        drip: 'نکته: نوع ست رو هم می‌تونی بگی: «ماکروست» یا «میکروست».',
        convert: 'نکته: عناصر پشتیبانی‌شده: سدیم، پتاسیم، کلسیم، منیزیم، بی‌کربنات.',
        drug: 'نکته: روش تزریق، حجم محلول، تعداد آمپول و مقدار دلخواه رو هم می‌تونی بگی.',
        gcs: 'نکته: برای RASS بگویید «مقیاس ریچموند ۲» یا «ریچموند منفی ۳».',
        rass: 'نکته: برای GCS بگویید «گلاسکو ۴ ۵ ۶».',
        braden: 'نکته: مقیاس برادن ۶ بخش دارد: حس، رطوبت، فعالیت، تحرک، تغذیه، اصطکاک.',
        morse: 'نکته: مقیاس مورس ۶ بخش دارد: سابقه سقوط، تشخیص ثانویه، وسیله کمکی، IV، راه رفتن، وضعیت ذهنی.',
        humpty: 'نکته: هامپی دامپی ۷ بخش دارد و برای ارزیابی خطر سقوط اطفال طراحی شده است.',
        burns: 'نکته: روی نواحی سوختگی در تصویر کلیک کنید — بزرگسال یا کودک را انتخاب کنید.',
        oxygen: 'نکته: فرمول: حجم کپسول (لیتر) × فشار (بار) × ۰.۹ ÷ جریان (L/min) = مدت (دقیقه).',
        vbg: 'نکته: برای VBG می‌تونی Na، Cl و آلبومین رو هم برای آنیون گپ بگی.',
        ventilator: 'نکته: برای تخمین قد، طول اولنا رو هم می‌تونی وارد کنی.',
        nutrition: 'نکته: با گفتن «سپسیس» یا «سوختگی» می‌تونی ضریب استرس رو تنظیم کنی.',
        ysite: 'نکته: دو دارو را با هم در یک جمله بگویید تا سازگاری Y-Site بررسی شود.'
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
        sodium_bicarbonate: ['bicarbonate', 'sodium bicarbonate', 'بی کربنات', 'بیکربنات']
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
    // FUZZY MATCHING
    // Speech recognition sometimes mishears a word slightly — "لازیکس"
    // heard as "لازیک", "بی ام آی" heard as "بی امای" — close enough that
    // a person would understand immediately, but a plain substring check
    // wouldn't. This computes character-level edit distance as a fallback
    // ONLY when exact matching finds nothing, so a near-miss still
    // resolves to the right drug/command instead of silently failing,
    // without weakening the fast, zero-false-positive exact-match path.
    // ============================================
    function levenshteinDistance(a, b) {
        if (a === b) return 0;
        const al = a.length, bl = b.length;
        if (al === 0) return bl;
        if (bl === 0) return al;
        let prevRow = new Array(bl + 1);
        for (let j = 0; j <= bl; j++) prevRow[j] = j;
        for (let i = 1; i <= al; i++) {
            const currRow = [i];
            for (let j = 1; j <= bl; j++) {
                const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
                currRow[j] = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + cost);
            }
            prevRow = currRow;
        }
        return prevRow[bl];
    }

    function fuzzySimilarity(a, b) {
        const maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 1;
        return 1 - levenshteinDistance(a, b) / maxLen;
    }

    const FUZZY_THRESHOLD = 0.72; // tunable — catches real near-misses without matching unrelated short words

    // Common Persian spellings and conservative ASR substitutions for every
    // drug currently available in FoxiMed. These are routing aliases only;
    // the displayed drug names and clinical database remain unchanged.
    const DRUG_SPEECH_ALIASES = {
        heparin: ['هپار', 'هپاری'],
        furosemide: ['فوروزماید', 'فروزماید', 'فوروزمید', 'فروسماید', 'فورسماید', 'فروزامید', 'فوروزمای', 'فورزماید', 'فزماید', 'لازیک', 'لازیکس'],
        insulin: ['انسولین', 'انسولین رگولر', 'انسولین رگولار'],
        fentanyl: ['فنتانل', 'فنتانی', 'فانیل'],
        pantoprazole: ['پنتاپرازول', 'پانتوپرازول', 'پ و پروزو', 'پتو پروراول'],
        nitroglycerin: ['نیتروگلیسرین', 'نیترو گلیسیرین', 'تی ان جی'],
        norepinephrine: ['نوراپینفرین', 'نور اپی نفرین', 'نورآدرنالین', 'نور آدرنالین', 'لووفد'],
        midazolam: ['میدازولم', 'میدازولان', 'میادوللان', 'میادولان', 'میدازوللان'],
        octreotide: ['اکتروتاید', 'اکترئوتید', 'اکتروتید', 'اکتوت تاید'],
        labetalol: ['لابیتالول', 'لابتول'],
        dopamine: ['دپامین', 'دوپامامی'],
        amiodarone: ['آمیودارون', 'امیودارون', 'آامیاد داران', 'عامیه دارون'],
        lidocaine: ['لیدوکایین', 'لیدوکاین', 'لیگنوکایین'],
        dobutamine: ['دوبوتامین', 'دوبوتامن']
    };

    // Best fuzzy score for `target` (space-stripped) found anywhere among
    // the tokens of `text` — tries single tokens and 2/3-token windows
    // (space-stripped too) so multi-word targets like "بیامای" still match
    // against "بی امای" said/heard with different word breaks.
    function bestFuzzyScoreInText(text, target) {
        if (!target || target.length < 3) return 0;
        const tokens = text.split(/\s+/).filter(Boolean);
        let best = 0;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].length >= 2) best = Math.max(best, fuzzySimilarity(tokens[i], target));
            if (i + 1 < tokens.length) best = Math.max(best, fuzzySimilarity(tokens[i] + tokens[i + 1], target));
            if (i + 2 < tokens.length) best = Math.max(best, fuzzySimilarity(tokens[i] + tokens[i + 1] + tokens[i + 2], target));
        }
        return best;
    }

    // ============================================
    // ROBUST TWO-DRUG DETECTION (for Y-Site)
    // The previous implementation matched two drugs with the regex
    // /(\w+)\s+(?:and|و)\s+(\w+)/, but `\w` only matches ASCII letters —
    // it can never match Persian script, so it silently failed for any
    // Persian sentence (i.e. almost every real voice command). This scans
    // the whole phrase for known drug names directly instead.
    // ============================================
    // The first, most distinctive word of a multi-word drug name (e.g.
    // "انسولین" from "انسولین رگولار") — people very commonly drop the
    // qualifier word in casual speech. Only used as a fallback, and only
    // for words long enough to be meaningfully distinctive (avoids a short
    // generic first word accidentally matching too broadly).
    function firstSignificantWord(name) {
        const first = String(name).split(/\s+/)[0];
        return first && first.length >= 3 ? first : null;
    }

    function findAllDrugNames(text, limit) {
        limit = limit || 2;
        const lower = text.toLowerCase();
        const found = [];

        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const speechAliases = DRUG_SPEECH_ALIASES[id] || [];
            const fullNames = [drug.persianName, drug.englishName].concat(drug.alternativeNames || [], speechAliases);
            const persianNames = [drug.persianName].concat(drug.alternativeNames || [], speechAliases)
                .filter(function (n) { return /[\u0600-\u06FF]/.test(n); });

            // Tier 1: full name, exact substring.
            let bestIndex = -1;
            for (let i = 0; i < fullNames.length; i++) {
                const idx = lower.indexOf(String(fullNames[i]).toLowerCase());
                if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) bestIndex = idx;
            }
            if (bestIndex !== -1) { found.push({ id: id, index: bestIndex, tier: 1 }); continue; }

            // Tier 2: first/most distinctive word of a multi-word name —
            // independent per drug, so one drug matching on tier 1 never
            // blocks another drug in the same sentence from reaching this.
            persianNames.forEach(function (n) {
                const word = firstSignificantWord(n);
                if (!word) return;
                const idx = lower.indexOf(word.toLowerCase());
                if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) bestIndex = idx;
            });
            if (bestIndex !== -1) { found.push({ id: id, index: bestIndex, tier: 2 }); continue; }

            // Tier 3: fuzzy match (Persian-script names only — fuzzy-
            // matching a transliterated English name against a Persian
            // transcript isn't meaningful).
            let bestScore = 0;
            persianNames.forEach(function (n) {
                bestScore = Math.max(bestScore, bestFuzzyScoreInText(lower, n.replace(/\s+/g, '')));
            });
            if (bestScore >= FUZZY_THRESHOLD) found.push({ id: id, index: 999999, tier: 3, score: bestScore });
        }

        // Prefer stronger tiers first (exact > first-word > fuzzy), then by
        // where in the sentence they appeared / fuzzy score.
        found.sort(function (a, b) {
            if (a.tier !== b.tier) return a.tier - b.tier;
            if (a.tier === 3) return b.score - a.score;
            return a.index - b.index;
        });

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
        const originalText = text;
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
            /(?:وزنم|وزن من|وزن|وزنش|وزن بیمار|weight)\s*(\d+(?:\.\d+)?)\s*(?:kg|کیلوگرم|کیلو)?/i,
            /(\d+(?:\.\d+)?)\s*(?:kg|کیلوگرم|کیلو)(?:\s*وزن)?/i,
            // Number BEFORE the keyword, no unit word required — natural
            // Persian allows either order ("وزن ۶۲" or "۶۲ وزنش"), and the
            // two patterns above only cover number-first when a unit word
            // like kg is also present.
            /(\d+(?:\.\d+)?)\s*(?:وزنم|وزن من|وزنش|وزن بیمار|وزن)/i,
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
            /(?:قدم|قد من|قد|قدش|قد بیمار|height)\s*(\d+(?:\.\d+)?)\s*(?:cm|سانتی متر|سانت)?/i,
            /(\d+(?:\.\d+)?)\s*(?:cm|سانتی متر|سانت)(?:\s*قد)?/i,
            // Number BEFORE the keyword, no unit word required (see weight
            // comment above for the same reasoning) — e.g. "۱۷۳ قدشه" said
            // without ever mentioning "cm" or "سانت" at all.
            /(\d+(?:\.\d+)?)\s*(?:قدم|قد من|قدش|قد بیمار|قد)/i,
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
        // No real adult/pediatric patient height is under 3 of anything
        // but meters — if someone says "قدش یک و شصت" (1.60) or just "1.6",
        // treat it as meters and convert, instead of requiring "متر" to be
        // said explicitly.
        if (params.height && params.height > 0 && params.height < 3) {
            params.height = params.height * 100;
        }

        const patterns = [
            { regex: /(?:سنم|سن من|سن)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:yr|سال|age|سنم|سن من|سنش|سن)/i, key: 'age' },
            { regex: /(\d+(?:\.\d+)?)\s*(ml|mL|cc|سی‌سی)/i, key: 'volume' },
            { regex: /(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)/i, key: 'dose' },
            { regex: /(\d+(?:\.\d+)?)\s*(meq|mEq)/i, key: 'meq' },
            { regex: /(\d+(?:\.\d+)?)\s*(bar|psi|mmhg|cmh2o|kpa|بار)/i, key: 'pressure' },
            { regex: /(\d+(?:\.\d+)?)\s*(L|litre|لیتر)/i, key: 'liters' },
            { regex: /(\d+(?:\.\d+)?)\s*(%|percent|درصد)/i, key: 'percent' },
            { regex: /(?:ph|پی اچ)\s*(\d+(?:\.\d+)?)/i, key: 'pH' },
            { regex: /(?:pco2|pco 2|پی سی او دو|پی سی اُدو)\s*(\d+(?:\.\d+)?)/i, key: 'pco2' },
            { regex: /(?:hco3|hco 3|بی کربنات|اچ سی او سه)\s*(\d+(?:\.\d+)?)/i, key: 'hco3' },
            { regex: /(?:be|بیس اکسس|بی ای)\s*([+-]?\d+(?:\.\d+)?)/i, key: 'be' },
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
                    params[p.key] = parseFloat(match[1] !== undefined ? match[1] : match[2]);
                    if (p.key === 'dose' && match[2]) params.doseUnit = String(match[2]).toLowerCase();
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

        // Check female first and use token boundaries: the English word
        // "female" contains "male", so substring matching classified women
        // as men in otherwise correctly recognized CrCl requests.
        if (/(?:^|\s)(?:female|زن)(?=\s|$)/i.test(text)) params.gender = 'female';
        else if (/(?:^|\s)(?:male|مرد)(?=\s|$)/i.test(text)) params.gender = 'male';

        const drugId = findDrugName(text);
        if (drugId) params.drugId = drugId;

        if (text.includes('ns') || text.includes('سالین')) params.solution = 'N.S';
        else if (text.includes('d5w') || text.includes('دکستروز')) params.solution = 'D5W';

        if (text.includes('سرنگ')) params.method = 'syringe';
        else if (text.includes('انفوزیون') || text.includes('پمپ') || text.includes('میکروست') || text.includes('ماکروست')) params.method = 'infusion';

        const ampMatch = text.match(/آمپول\s*(\d+)/i);
        if (ampMatch) params.ampoules = parseInt(ampMatch[1]);

        const customMatch = text.match(/(دلخواه|مقدار)\s*(\d+(?:\.\d+)?)\s*(units|mg|mcg|g)/i);
        if (customMatch) {
            params.customAmount = parseFloat(customMatch[2]);
            params.customUnit = customMatch[3].toLowerCase();
        }

        const flowMatch = text.match(/(\d+(?:\.\d+)?)\s*(L\/min|litre\/min|لیتر در دقیقه)/i);
        if (flowMatch) params.flow = parseFloat(flowMatch[1]);

        if (/(?:در|بر|هر)\s*ساعت/i.test(text)) params.ratePeriod = 'hour';
        else if (/(?:در|بر|هر)\s*دقیقه/i.test(text)) params.ratePeriod = 'minute';

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

        const humptyMatch = text.match(/(?:هامپی\s*دامپی|هامپتی\s*دامپتی|humpty\s*dumpty)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)/i);
        if (humptyMatch) params.humptyScores = humptyMatch.slice(1, 8).map(Number);

        params._original = originalText;
        return params;
    }

    // ============================================
    // COMMAND KEYWORDS + SCORING
    // ============================================
    const COMMAND_KEYWORDS = {
        tab_calculator: { triggers: ['ماشین حساب', 'calculator tab', 'go to calculator', 'ماشین حساب'], scoreWeight: 0.7 },
        tab_drugs: { triggers: ['مرجع داروها', 'کتابخانه دارو', 'لیست داروها', 'داروخانه', 'drug library', 'drugs tab', 'رفتن به داروها'], scoreWeight: 0.7 },
        tab_tools: { triggers: ['ابزارها', 'تب ابزار', 'ابزارهای بالینی', 'tools tab', 'رفتن به ابزارها', 'ابزارک ها'], scoreWeight: 0.7 },

        clear: { triggers: ['پاک کن', 'پاک کردن', 'صفر', 'clear results', 'reset', 'پاکسازی', 'حذف نتایج'], scoreWeight: 0.8 },
        manual_calc: { triggers: [' دستی', 'دستی', 'manual calculation', 'custom calculation', ' بدون دارو', ' دلخواه'], scoreWeight: 0.9 },
        history: { triggers: ['تاریخچه', 'محاسبات قبلی', 'سابقه محاسبات', 'تاریخچه محاسبات', 'history', 'گزارش محاسبات'], scoreWeight: 0.9 },
        reverse: { triggers: ['reverse', 'معکوس', 'برعکس', 'وارونه', 'حالت معکوس'], scoreWeight: 0.9 },

        bmi: { triggers: ['bmi', 'بی ام آی', 'بی ام ای', 'بیامای', 'b.m.i', 'شاخص توده', 'شاخص توده بدنی', 'body mass index', 'توده بدنی', 'جرم بدن', 'شاخص وزن', 'وزن و قد'], scoreWeight: 0.9 },
        bsa: { triggers: ['bsa', 'بی اس ای', 'بی اس آی', 'بیاسای', 'b.s.a', 'سطح بدن', 'سطح بدن بیمار', 'مساحت سطح بدن', 'body surface area', 'mosteller', 'dubois', 'haycock', 'مساحت بدن'], scoreWeight: 0.9 },
        ibw: { triggers: ['وزن ایده آل', 'ideal weight', 'ibw', 'وزن ایده ال', 'وزن مناسب', 'وزن استاندارد', 'وزن مطلوب', 'وزن ایده آل بیمار'], scoreWeight: 0.9 },
        crcl: { triggers: ['crcl', 'سی آر سی ال', 'creatinine clearance', 'کلیرانس کراتینین', 'کلیرنس کراتینین', 'کراتینین کلیرنس', 'تصفیه کراتینین', 'کراتینین', 'کلیرانس', 'کلیرنس', 'clearance', 'کارکرد کلیه', 'نارسایی کلیه', 'cockcroft'], scoreWeight: 0.9 },
        drip: { triggers: ['drip', 'قطره', 'سرعت قطره', 'gravity', 'میکروست', 'ماکروست', 'قطره در دقیقه', 'تعداد قطره', 'سرعت سرم', 'سرم چند قطره'], scoreWeight: 0.9 },
        gcs: { triggers: ['gcs', 'جی سی اس', 'جیسیاس', 'گلاسکو', 'امتیاز گلاسکو', 'glasgow', 'coma', 'کما', 'eye', 'verbal', 'motor', 'چشمی', 'کلامی', 'حرکتی', 'امتیاز هوشیاری', 'سطح هوشیاری', 'هوشیاری گلاسکو'], scoreWeight: 0.8 },
        rass: { triggers: ['rass', 'آر اس اس', 'آراس اس', 'ریچموند', 'مقیاس ریچموند', 'richmond', 'agitation', 'sedation', 'آرام بخشی', 'آژیتیشن', 'مقیاس آرام بخشی', 'میزان سدیشن', 'سدیشن ریچموند'], scoreWeight: 0.8 },
        braden: { triggers: ['braden', 'برادن', 'pressure ulcer', 'زخم فشاری', 'sensory', 'moisture', 'activity', 'mobility', 'nutrition', 'friction', 'حس', 'رطوبت', 'فعالیت', 'تحرک', 'تغذیه', 'اصطکاک', 'زخم بستر', 'ریسک زخم بستر', 'خطر زخم فشاری'], scoreWeight: 0.8 },
        morse: { triggers: ['morse', 'مورس', 'fall', 'سقوط', 'history', 'diagnosis', 'aid', 'gait', 'mental', 'افتادن', 'تشخیص', 'وسیله', 'راه رفتن', 'ذهنی', 'خطر سقوط', 'ریسک سقوط', 'احتمال افتادن'], scoreWeight: 0.8 },
        humpty: { triggers: ['humpty dumpty', 'humpty', 'هامپی دامپی', 'هامپتی دامپتی', 'هامپی', 'هامپتی', 'خطر سقوط کودک', 'ریسک سقوط کودک', 'سقوط اطفال', 'خطر سقوط اطفال', 'پدیاتریک فال'], scoreWeight: 0.95 },
        burns: { triggers: ['burns', 'سوختگی', 'tbsa', 'درصد سوخت', 'درصد سطح سوخت', 'fire', 'آتش', 'پارکلند', 'parkland', 'قانون نُه', 'rule of nines', 'سطح سوختگی', 'درصد سوختگی', 'درصد سطح سوختگی', 'سوختگی پوست', 'وسعت سوختگی', 'سطح سوختگی بدن'], scoreWeight: 0.8 },
        oxygen: { triggers: ['oxygen', 'اکسیژن', 'کپسول', 'cylinder', 'اکسیژن درمانی', 'کپسول اکسیژن', 'مدت اکسیژن', 'زمان باقی مانده کپسول', 'کپسول چقدر میمونه'], scoreWeight: 0.8 },
        vbg: { triggers: ['vbg', 'abg', 'وی بی جی', 'ای بی جی', 'گاز خون', 'blood gas', 'ph', 'pco2', 'hco3', 'base excess', 'be', 'bicarbonate', 'بی کربنات', 'گازهای خون', 'تفسیر گاز خون', 'تفسیر وی بی جی', 'تفسیر ای بی جی', 'اسید باز', 'اسید و باز'], scoreWeight: 0.8 },
        ventilator: { triggers: ['ventilator', 'ونتیلاتور', 'tidal volume', 'حجم جاری', 'pbw', 'ards', 'lung protective', 'تهویه', 'حجم تنفسی', 'تی وی', 'تایدال', 'دستگاه تنفس'], scoreWeight: 0.8 },
        nutrition: { triggers: ['nutrition', 'تغذیه', 'کالری', 'calories', 'protein', 'پروتئین', 'bmr', 'harris', 'mifflin', 'استرس', 'stress', 'نیاز کالری', 'کالری روزانه', 'پروتئین مورد نیاز', 'نیاز انرژی', 'تغذیه انترال'], scoreWeight: 0.8 },

        convert: { triggers: ['convert', 'تبدیل', 'meq', 'میلی اکی والان', 'الکترولیت', 'تبدیل واحد'], scoreWeight: 0.9 },
        electrolyte: { triggers: ['الکترولیت', 'تبدیل الکترولیت', 'meq به mg', 'mg به meq', 'سدیم', 'پتاسیم', 'کلسیم', 'منیزیم', 'بی کربنات', 'electrolyte'], scoreWeight: 0.9 },
        percentage: { triggers: ['درصد', 'غلظت درصد', 'percentage solution', 'محلول درصدی', 'درصد دارو'], scoreWeight: 0.9 },
        unit_convert: { triggers: ['تبدیل واحد', 'تبدیل units', 'میکروگرم', 'میلی گرم', 'unit conversion', 'مبدل واحد', 'مبدل units'], scoreWeight: 0.9 },
        temp_convert: { triggers: ['تبدیل دما', 'درجه', 'سلسیوس', 'فارنهایت', 'temperature', 'دمای بدن', 'تب'], scoreWeight: 0.9 },
        weight_convert: { triggers: ['تبدیل وزن', 'پوند', 'weight conversion', 'وزن به پوند', 'وزن به کیلو'], scoreWeight: 0.9 },
        pressure_convert: { triggers: ['مبدل فشار', 'تبدیل فشار', 'pressure conversion', 'پی اس آی', 'میلی متر جیوه', 'سانتی متر آب', 'کیلو پاسکال'], scoreWeight: 0.9 },

        drug: { triggers: ['دوز', 'انفوزیون', 'تزریق', 'پمپ', 'سرنگ', 'سرعت پمپ', 'دوز انفوزیون', 'محاسبه دارو', 'kg/h', 'mcg', 'mg', 'units', 'آمپول', 'ویال', 'دوز دارو'], scoreWeight: 1.0 },
        druginfo: { triggers: ['اطلاعات', 'درباره', 'توضیح', 'شرح', 'کاربرد', 'مقدار مصرف', 'نحوه مصرف', 'چیه', 'چیست', 'info', 'about', 'describe', 'معرفی', 'راهنما دارو'], scoreWeight: 0.9 },
        dose_calc: { triggers: [' دوز', 'دوز دارو', 'حجم ویال', 'dose calculation', 'vial', 'حجم تزریقی', 'مقدار مصرف دارو'], scoreWeight: 0.9 },
        compat_tool: { triggers: ['سازگاری دارو', 'compatibility', 'تداخل دارویی', 'داروها', 'drug compatibility', 'سازگاری y-site', 'y-site', 'مخلوط داروها'], scoreWeight: 0.9 },
        ysite: { triggers: ['ysite', 'y-site', 'سازگاری', 'تداخل', 'mix', 'مخلوط', 'همزمان', 'تزریق همزمان', 'همزمان وصل کنم', 'داخل یک سرم', 'میشه با هم زد', 'y-site compatibility'], scoreWeight: 0.8 },

        settings: { triggers: ['dark mode', 'light mode', 'تاریک', 'روشن', 'دارک', 'لایت', 'large font', 'small font', 'فونت بزرگ', 'فونت کوچک', 'تم تاریک', 'تم روشن', 'تنظیمات', 'تنظیماتو', 'تنظیمات رو باز کن', 'settings', 'حالت شب', 'حالت روز'], scoreWeight: 0.7 },
        theme: { triggers: ['فاکس', 'fox', 'روباه', 'اقیانوس', 'ocean', 'رز', 'rose', 'جنگل', 'forest', 'پیش فرض', 'default', 'تم فاکس', 'تم اقیانوس', 'تم رز', 'تم جنگل', 'theme fox', 'theme ocean', 'theme rose', 'theme forest', 'dreamfire', 'تم شرابی', 'theme dreamfire', 'هدو', 'سایرن', 'لینکس', 'ویکسن', 'شرابی', 'زرشکی', 'گیلاسی'], scoreWeight: 0.9 },

        help: { triggers: ['help', 'راهنما', 'کمک', 'راهنمایی', 'نمونه', 'example', 'چه کارایی', 'چه کارهایی بلدی', 'چیکار بلدی', 'چه توانایی هایی داری', 'چطور کار کنم', 'راهنمای صوتی', 'چه کار کنم'], scoreWeight: 0.6 }
    };

    const GENERIC_FUZZY_TRIGGERS = new Set(['به', 'در', 'to', 'be', 'mg', 'mcg']);

    function exactTriggerMatch(text, trigger) {
        const haystack = ' ' + normalizeTranscript(text).toLowerCase() + ' ';
        const needle = normalizeTranscript(trigger).toLowerCase();
        return !!needle && haystack.includes(' ' + needle + ' ');
    }

    function triggerScore(text, triggers) {
        const lower = normalizeTranscript(text).toLowerCase();
        let exactMatches = 0;
        let bestFuzzy = 0;
        for (let i = 0; i < triggers.length; i++) {
            const trigger = normalizeTranscript(triggers[i]).toLowerCase();
            if (!trigger) continue;
            if (exactTriggerMatch(lower, trigger)) {
                exactMatches++;
                continue;
            }
            const compact = trigger.replace(/\s+/g, '');
            if (compact.length >= 4 && !GENERIC_FUZZY_TRIGGERS.has(trigger)) {
                bestFuzzy = Math.max(bestFuzzy, bestFuzzyScoreInText(lower, compact));
            }
        }
        const fuzzyThreshold = bestFuzzy >= 0.80 || (bestFuzzy >= 0.76 && lower.length >= 6);
        return Math.min(2, exactMatches) + (exactMatches === 0 && fuzzyThreshold ? 0.70 : 0);
    }

    function scoreCommand(text, params) {
        const scores = {};
        for (const cmd in COMMAND_KEYWORDS) {
            const info = COMMAND_KEYWORDS[cmd];
            let score = triggerScore(text, info.triggers);
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
            if (cmd === 'humpty' && params.humptyScores) score += 2;
            if (cmd === 'humpty' && /(?:کودک|اطفال|pediatric)/i.test(text) && /(?:سقوط|افتادن|fall)/i.test(text)) score += 3;
            if (cmd === 'morse' && /(?:کودک|اطفال|pediatric)/i.test(text) && /(?:سقوط|افتادن|fall)/i.test(text)) score = 0;
            const burnsPhrase = /درصد\s+(?:سطح\s+)?سوخت(?:گی)?/.test(text);
            if (cmd === 'burns' && (text.includes('سوختگی') || burnsPhrase)) score += 3;
            // "درصد" normally means solution concentration, but in
            // "درصد [سطح] سوخت(گی)" it is part of the burns calculation.
            // Do not let the generic percentage tool outrank that much
            // more specific clinical phrase when ASR clips the final "گی".
            if (cmd === 'percentage' && burnsPhrase) score = 0;
            if (cmd === 'oxygen' && (params.flow || params.pressure || params.liters)) score += 2;
            if (cmd === 'oxygen' && /(?:اکسیژن|کپسول)/.test(text) && /(?:مدت|زمان|چقدر|میمونه|باقی)/.test(text)) score += 3;
            if (cmd === 'pressure_convert' && score > 0 && /(?:تبدیل|مبدل|psi|mmhg|cmh2o|kpa|پی اس آی|میلی متر جیوه|سانتی متر آب|کیلو پاسکال)/i.test(text)) score += 2;
            if (cmd === 'unit_convert' && /(?:تبدیل|مبدل)\s+(?:واحد|units?)/i.test(text)) score += 2;
            if (cmd === 'temp_convert' && /(?:تبدیل|مبدل)\s+(?:دما|درجه)/.test(text)) score += 2;
            if (cmd === 'weight_convert' && /(?:تبدیل|مبدل)\s+وزن/.test(text)) score += 2;
            if (cmd === 'ventilator' && score > 0 && (params.height || params.weight)) score += 2;
            if (cmd === 'nutrition' && score > 0 && (params.weight || params.height || params.age)) score += 2;
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
        'راهنما': function () { showVoiceResult('می‌تونم محاسبه‌گر دارو یا ابزار بالینی موردنظرت رو باز کنم، عددهایی که می‌گی رو وارد کنم، اطلاعات و سازگاری داروها رو پیدا کنم و ظاهر برنامه رو تغییر بدم. مثلاً بگو: «انفوزیون هپارین»، «BMI وزن ۷۵ قد ۱۷۵»، «درصد سوختگی»، «گلاسکو ۴ ۵ ۶»، «سازگاری هپارین و وانکومایسین» یا «حالت تاریک». دستورهای بالینی رو فقط بعد از تأییدت اجرا می‌کنم.', 'info'); },
        'ماشین حساب': function () { switchTab('calculator'); showVoiceResult('بخش ماشین حساب باز شد', 'success'); },
        'دارو': function () { switchTab('drugs'); showVoiceResult('مرجع داروها باز شد', 'success'); },
        'داروها': function () { switchTab('drugs'); showVoiceResult('مرجع داروها باز شد', 'success'); },
        'ابزارها': function () { switchTab('tools'); showVoiceResult('ابزارهای بالینی باز شد', 'success'); }
    };

    const PERSIAN_NUMBER_WORDS = {
        'یک': '1', 'دو': '2', 'سه': '3', 'چهار': '4', 'پنج': '5',
        'شش': '6', 'هفت': '7', 'هشت': '8', 'نه': '9', 'ده': '10',
        'یازده': '11', 'دوازده': '12', 'سیزده': '13', 'چهارده': '14', 'پانزده': '15',
        'شانزده': '16', 'هفده': '17', 'هجده': '18', 'نوزده': '19', 'بیست': '20',
        'سی': '30', 'چهل': '40', 'پنجاه': '50', 'شصت': '60', 'هفتاد': '70', 'هشتاد': '80', 'نود': '90', 'صد': '100', 'یکصد': '100',
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
        'میلی گرم': 'mg', 'میلیگرم': 'mg', 'می گرم': 'mg',
        'میکرو گرم': 'mcg', 'میکروگرم': 'mcg', 'میترلو': 'mcg',
        'میلی لیتر': 'ml',
        'سی سی': 'cc',
        'گرم': 'g', 'واحد': 'units'
    };

    // ============================================
    // COLLOQUIAL SPEECH NORMALIZATION
    // Natural spoken Persian contracts "است/هست" (is) onto the word before
    // it — "شصت است" becomes "شصته", "کیلو است" becomes "کیلوئه" — and
    // combines hundreds with the next number via a fused "و" with no space
    // — "صد و" said quickly becomes "صدو". None of this shows up in
    // formal written Persian, but it's exactly how people actually talk,
    // and it's exactly what a speech engine transcribes. Untangling this
    // BEFORE number/unit extraction fixes real, reported failures like
    // "هفتاد کیلوئه" (is seventy kilos) and "صدو شصته" (is a hundred
    // and sixty) not being understood at all.
    // ============================================
    const HUNDREDS_WORDS = ['هزار', 'نهصد', 'هشتصد', 'هفتصد', 'ششصد', 'پانصد', 'چهارصد', 'سیصد', 'دویست', 'صد'];

    function normalizeColloquialSpeech(text) {
        // Fused "[hundreds-word]و" -> "[hundreds-word] و" (صدو -> صد و)
        HUNDREDS_WORDS.forEach(function (w) {
            text = text.replace(new RegExp('(^|\\s)' + w + 'و(?=\\s|$)', 'g'), '$1' + w + ' و');
        });
        // "کیلوئه"/"سانتیمتره"/"سانته" -> bare unit word
        text = text.replace(/کیلوئه/g, 'کیلو');
        text = text.replace(/سانتی\s?متره|سانته/g, 'سانت');
        text = text.replace(/سالشه|ساله/g, 'سال');
        // Same "-ه" (است/هست, "is") contraction, but on the weight/height/
        // age KEYWORD itself rather than a number — "قدشه" (his height IS)
        // is the exact same colloquial pattern as "شصته" (sixty IS), just
        // applied to "قدش" instead of a number word. Without this, a very
        // natural phrase like "صد هفتاد قدشه" silently fails to recognize
        // "قدشه" as the height keyword at all.
        text = text.replace(/قدشه(?=\s|$)/g, 'قدش');
        text = text.replace(/قدمه(?=\s|$)/g, 'قدم');
        text = text.replace(/وزنشه(?=\s|$)/g, 'وزنش');
        text = text.replace(/وزنمه(?=\s|$)/g, 'وزنم');
        text = text.replace(/سنشه(?=\s|$)/g, 'سنش');
        text = text.replace(/سنمه(?=\s|$)/g, 'سنم');
        // Any known number word with the "-ه" contraction (شصته -> شصت),
        // skipping single-letter-result words like "سه"/"نه" which already
        // legitimately end in "ه" themselves (handled by exact match first
        // everywhere this matters, so stripping here is purely additive).
        const allNumberWords = Object.keys(PERSIAN_NUMBER_WORDS).filter(function (w) { return w.length > 2; });
        allNumberWords.sort(function (a, b) { return b.length - a.length; });
        allNumberWords.forEach(function (w) {
            text = text.replace(new RegExp('(^|\\s)' + w + 'ه(?=\\s|$)', 'g'), '$1' + w);
        });
        return text;
    }

    // Matches a number word, including after stripping a colloquial "-ه"
    // contraction, returning the numeric value or null.
    function matchNumberToken(token) {
        if (PERSIAN_NUMBER_WORDS.hasOwnProperty(token)) return parseInt(PERSIAN_NUMBER_WORDS[token], 10);
        if (token.length > 1) {
            const stripped = token.slice(0, -1);
            if (PERSIAN_NUMBER_WORDS.hasOwnProperty(stripped)) return parseInt(PERSIAN_NUMBER_WORDS[stripped], 10);
        }
        return null;
    }

    // Persian builds compound numbers additively with "و" (and) —
    // "صد و شصت" = 100 + 60 = 160, "هزار و دویست و سی" = 1000+200+30=1230.
    // The previous word-by-word replacement turned "صد و شصت" into the
    // literal text "100 و 60" without ever summing them. This walks the
    // token stream and collapses each consecutive number-word run
    // (connected by "و" or directly fused with it) into its actual total.
    function convertCompoundPersianNumbers(text) {
        const tokens = text.split(/\s+/);
        const output = [];
        let i = 0;
        while (i < tokens.length) {
            const firstVal = matchNumberToken(tokens[i]);
            if (firstVal === null) { output.push(tokens[i]); i++; continue; }
            let sum = firstVal;
            const startedOnHundreds = firstVal >= 100;
            let j = i + 1;
            while (j < tokens.length) {
                if (tokens[j] === 'و' && j + 1 < tokens.length) {
                    const nextVal = matchNumberToken(tokens[j + 1]);
                    if (nextVal === null) break;
                    sum += nextVal;
                    j += 2;
                    continue;
                }
                // No "و" between this and the next token — only bridge this
                // gap if we started on a hundreds/thousands word followed
                // directly by a smaller (tens/ones) value, e.g. "صد هفتاد"
                // said without the formally-correct middle "و". This is
                // deliberately narrow: it does NOT apply to two arbitrary
                // adjacent small numbers, so separate-number sequences like
                // spoken GCS scores ("چهار پنج شش" = 4, 5, 6) are never
                // accidentally summed into one wrong number.
                if (startedOnHundreds) {
                    const directVal = matchNumberToken(tokens[j]);
                    if (directVal !== null && directVal < 100 && directVal > 0) {
                        sum += directVal;
                        j += 1;
                        continue;
                    }
                }
                break;
            }
            output.push(String(sum));
            i = j;
        }
        return output.join(' ');
    }

    function normalizeAndConvertNumbers(text) {
        return convertCompoundPersianNumbers(normalizeColloquialSpeech(text));
    }

    // ============================================
    // ACRONYM PROTECTION
    // Some Persian number words are ALSO the Persian name of a Latin
    // letter — "سی" is both "thirty" and the letter "C". Spelled-out
    // acronyms like "جی سی اس" (G-C-S, i.e. GCS) collide with this: the
    // number converter was turning "جی سی اس" into "جی 30 اس", destroying
    // the command before it could ever be recognized. Known spelled-out
    // acronym phrases are protected with a placeholder BEFORE number
    // conversion runs, then restored immediately after — so "سی" still
    // means 30 everywhere else (e.g. "سی میلی‌گرم"), just not inside one
    // of these specific known phrases.
    // ============================================
    const PROTECTED_ACRONYM_PHRASES = [
        'جی سی اس', 'آر اس اس', 'بی ام آی', 'بی ام ای', 'بی اس ای', 'بی اس آی', 'وی بی جی', 'ای بی جی'
    ];

    function withAcronymsProtected(text, fn) {
        const placeholders = [];
        let protectedText = text;
        PROTECTED_ACRONYM_PHRASES.forEach(function (phrase, idx) {
            const token = '\u0000ACR' + idx + '\u0000';
            if (protectedText.indexOf(phrase) !== -1) {
                protectedText = protectedText.split(phrase).join(token);
                placeholders.push({ token: token, phrase: phrase });
            }
        });
        let result = fn(protectedText);
        placeholders.forEach(function (p) {
            result = result.split(p.token).join(p.phrase);
        });
        return result;
    }

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
            'سلام! چطور می‌تونم کمکت کنم؟',
            'درود، خوش اومدی. چه کاری داری؟',
            'سلام! برای کدوم محاسبه یا ابزار اومدی؟'
        ],
        'صبح بخیر|صبحت بخیر|صبح شما بخیر': [
            'صبح شما هم بخیر. امیدوارم شیفت خوبی داشته باشی.',
            'صبح بخیر! بگو امروز چه کمکی از دستم برمیاد.'
        ],
        'شب بخیر|شبت بخیر|شب شما بخیر': [
            'شب شما هم بخیر. مراقب خودت باش.',
            'شب بخیر! هر وقت لازم شد من اینجام.'
        ],
        // identity / about the app
        'اسمت چیه|اسمت چیست|تو کی هستی|معرفی کن خودتو|خودتو معرفی کن': [
            'من فاکسی‌ام، دستیار فاکسی‌مد. چیزی که می‌خوای رو به ابزار یا محاسبه مربوط وصل می‌کنم.',
            'من دستیار فاکسی‌مدم؛ برای محاسبات، ابزارها و مرجع دارویی کنارتم.'
        ],
        // nurse life — tiredness / shift difficulty
        'خسته ام|خستم|خستگی|خسته شدم': [
            'خسته نباشی. اگر شرایط بخش اجازه می‌ده، چند دقیقه مکث و کمی آب می‌تونه کمک‌کننده باشه.',
            'می‌فهمم؛ شیفت می‌تونه واقعاً فرساینده باشه. اگر کاری از برنامه می‌خوای، کوتاه بگو تا سریع انجامش بدیم.'
        ],
        'شیفت بد|شیفت سخته|شیفت سخت': [
            'متأسفم که شیفت سختی داری. بگو کدوم کار رو می‌تونم برات سریع‌تر کنم.',
            'بعضی شیفت‌ها واقعاً سنگینن. قدم‌به‌قدم پیش برو و اگه لازم شد از همکارت کمک بخواه.'
        ],
        'تموم نمیشه|کی تموم میشه|چرا تموم نمیشه': [
            'می‌فهمم؛ بعضی شیفت‌ها انگار خیلی کند می‌گذرن. فعلاً یکی‌یکی جلو بریم.',
            'هنوز اینجام. اگر کاری هست که می‌شه سریع‌ترش کرد، بگو.'
        ],
        'سرم خیلی شلوغه|سرم شلوغه|خیلی کار دارم|کار ریخته سرم|شلوغه|شلوغ|پرکاره|پرکار': [
            'اوه، معلومه سرت شلوغه. کوتاه بگو چی لازم داری؛ مستقیم همون بخش رو باز می‌کنم.',
            'می‌فهمم؛ وقتی کارها پشت‌سرهم می‌رسن واقعاً سنگینه. یکی‌یکی بریم—محاسبه یا ابزار بعدی چیه؟'
        ],
        'پاهام درد|کمردرد|درد میکنه|کمرم درد': [
            'متأسفم. اگه می‌تونی وضعیت بدنت رو عوض کن و کمی استراحت کن؛ درد مداوم یا شدید رو نادیده نگیر.',
            'سرپا موندن طولانی واقعاً سخته. اگه درد ادامه داره، بهتره برای ارزیابی مناسب پیگیریش کنی.'
        ],
        'خوابم میاد|چقدر خوابم میاد|شیفت شب سخته': [
            'شیفت شب سخته. اگه خواب‌آلودگی روی ایمنی کارت اثر گذاشته، حتماً به همکار یا مسئول شیفت بگو.',
            'اگه شرایط بخش اجازه می‌ده، یه استراحت کوتاه می‌تونه کمک کنه. بگو چه کاری رو برات سریع‌تر کنم.'
        ],
        'گرسنه شدم|گرسنه ام|گرسنمه|گرسنه|گشنه ام|گشنمه|گشنم': [
            'اوه، امیدوارم خیلی زود فرصت کنی یه چیزی بخوری. تا اون موقع هر کاری می‌تونم کوتاه‌تر کنم بگو.',
            'گشنه موندن وسط شیفت اصلاً خوشایند نیست. اگر فرصت امنی پیدا شد، یه خوراکی و آب یادت نره.'
        ],
        'تشنه شدم|تشنه ام|تشنمه|تشنم|تشنه': [
            'اوه، امیدوارم خیلی زود فرصت کنی آب بخوری. تا اون موقع هر کاری می‌تونم کوتاه‌تر کنم بگو.',
            'تشنگی وسط شیفت واقعاً آزاردهنده است. اگر فرصت امنی پیدا شد، یه لیوان آب یادت نره.'
        ],
        'استرس دارم|نگرانم|اعصابم': [
            'می‌فهمم. فعلاً چند نفس آرام بکش و کارها رو یکی‌یکی جلو ببر.',
            'اگه فشار زیاد شده، حرف زدن با یه همکار قابل‌اعتماد یا مسئول شیفت می‌تونه کمک کنه.'
        ],
        // gratitude / praise
        'متشکرم|ممنون|مرسی|تشکر': [
            'خواهش می‌کنم. هر وقت لازم شد من اینجام.',
            'قابلی نداشت؛ بگو کار بعدی چیه.'
        ],
        'دستت درد نکنه|دست شما درد نکنه': [
            'خواهش می‌کنم. خوشحالم به دردت خورد.',
            'ممنون؛ هر وقت لازم شد صدام کن.'
        ],
        'ایول|آفرین|چه عالی|عالیه': [
            'ممنون! خوشحالم که درست انجام شد.',
            'عالیه؛ بریم سراغ کار بعدی.'
        ],
        'این اپ خوبه|عالیه این برنامه|اپ خوبیه': [
            'خیلی خوشحالم که برات مفیده. هر ایراد یا پیشنهادی دیدی بگو.',
            'ممنون! بازخورد شما کمک می‌کنه فاکسی‌مد بهتر بشه.'
        ],
        // apology
        'ببخشید|شرمنده|معذرت': [
            'مشکلی نیست؛ بگو چی لازم داری.',
            'خواهش می‌کنم، راحت باش.'
        ],
        // Keep this honest and friendly; canned jokes reduced trust and did
        // not land well in testing.
        'جوک بگو|بخندونم|یه چیز خنده دار بگو': [
            'راستش جوک گفتنم تعریفی نداره؛ ولی برای محاسبه‌ها و ابزارهای بالینی آماده‌ام.',
            'تو بخش جوک خیلی قوی نیستم؛ بگو چه کاری از دستم برمیاد.'
        ],
        // farewell
        'خداحافظ|بای|فعلا|می بینمت|میرم دیگه': [
            'خداحافظ، مراقب خودت باش.',
            'فعلاً! هر وقت لازم شد من اینجام.',
            'به سلامت؛ امیدوارم ادامه شیفت آروم‌تر باشه.'
        ],
        // how are you (kept after the more specific entries above)
        'چطوری|خوبی|حالت چطوره|چطورید|چطورین': [
            'خوبم، ممنون. تو چطوری؟',
            'آماده‌ام کمک کنم. حال تو چطوره؟'
        ],
        'چه خبر|چخبر|چه میکنی|چیکار میکنی': [
            'خبر خاصی نیست؛ منتظرم بگی کدوم ابزار یا محاسبه رو لازم داری.',
            'دارم برای فرمان بعدی آماده می‌مونم. تو چه خبر؟'
        ],
        'حوصلم سر رفته|حوصله ام سر رفته|حوصله ندارم': [
            'یه نفس کوتاه بین کارها بد نیست. اگر کاری داری بگو تا سریع انجامش بدیم.',
            'می‌فهمم. اگر دوست داری یکی از ابزارهای برنامه رو با هم امتحان کنیم.'
        ],
        'دوستت دارم|دوست دارم|صداتو دوست دارم': [
            'لطف داری. خوشحالم که همراه مفیدی برات هستم.',
            'مرسی؛ من هم خوشحالم که می‌تونم کمکت کنم.'
        ],
        'تو واقعی هستی|رباتی|تو رباتی|آدمی': [
            'من یه دستیار نرم‌افزاری‌ام، نه آدم. درخواست‌هات رو به ابزارهای فاکسی‌مد وصل می‌کنم.',
            'من دستیار گفت‌وگویی فاکسی‌مدم و جواب‌هام جای قضاوت بالینی رو نمی‌گیرن.'
        ],
        'چند سالته|سنت چقدره|پسری یا دختری|دختری|پسری': [
            'سن یا جنسیت انسانی ندارم؛ من دستیار نرم‌افزاری فاکسی‌مدم.',
            'من یه برنامه‌ام، ولی می‌تونم برای محاسبات و ابزارهای فاکسی‌مد کنارت باشم.'
        ],
        'دمت گرم|باهوشی': [
            'ممنون! خوشحالم که درست کار کرد.',
            'مرسی؛ بگو کار بعدی چیه.'
        ],
        // generic confirmations — broad and low-specificity, kept last
        'بله|اوکی|باشه|چشم|حتماً|خوبه': [
            'باشه؛ هر وقت آماده‌ای بگو.',
            'چشم، منتظر درخواست بعدیتم.',
            'خوبه؛ بگو چه کاری انجام بدم.'
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

        const hasClinicalIntent = Object.keys(COMMAND_KEYWORDS).some(function (command) {
            return COMMAND_KEYWORDS[command].triggers.some(function (trigger) {
                const normalizedTrigger = normalizeTranscript(trigger).toLowerCase();
                if ((normalizedTrigger === 'استرس' || normalizedTrigger === 'stress') && /^(?:استرس دارم|نگرانم|اعصابم)$/.test(lower)) return false;
                return exactTriggerMatch(lower, normalizedTrigger);
            });
        });
        if (hasClinicalIntent) return false;

        const compactPhrase = lower.replace(/\s+/g, '');
        function resemblesAny(targets, threshold) {
            return targets.some(function (target) {
                return fuzzySimilarity(compactPhrase, target.replace(/\s+/g, '')) >= threshold;
            });
        }
        function replyFromSmallTalk(key) {
            const replies = SMALL_TALK[key];
            if (!replies || !replies.length) return false;
            showVoiceResult(replies[Math.floor(Math.random() * replies.length)], 'success');
            return true;
        }

        // Short Persian phrases are particularly vulnerable to one-character
        // substitutions on phone microphones. Keep this recovery strictly in
        // the non-clinical path above so it can never rewrite a drug or dose.
        const hungerKey = 'گرسنه شدم|گرسنه ام|گرسنمه|گرسنه|گشنه ام|گشنمه|گشنم';
        if (!/^تشن/.test(compactPhrase) && resemblesAny(['گرسنه ام', 'گرسنمه', 'گشنمه', 'گشنم'], 0.72)) {
            return replyFromSmallTalk(hungerKey);
        }

        function openCreatorContact() {
            creatorContactFollowupUntil = 0;
            if (DOM.settingsModal) {
                DOM.settingsModal.classList.add('active');
                document.body.classList.add('no-scroll');
            }
            setTimeout(function () {
                const contact = document.getElementById('creatorContact');
                if (!contact) return;
                if (contact.classList) contact.classList.add('voice-contact-highlight');
                if (typeof contact.scrollIntoView === 'function') contact.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(function () {
                    if (contact.classList) contact.classList.remove('voice-contact-highlight');
                }, 1900);
            }, 250);
            showVoiceResult('حتماً؛ راه ارتباط با محمدمهدی تقوی رو توی بخش تلگرام تنظیمات نشونت دادم.', 'success');
            return true;
        }

        const creatorQuestion = /^(?:سازنده|سازندت|سازندت کیه|سازنده ت کیه|سازنده ات کیه|کی تورو ساخت|کی تورو ساخته|کی تو رو ساخت|کی تو رو ساخته|تورو کی ساخت|تورو کی ساخته|تو رو کی ساخت|تو رو کی ساخته|کی ساختت|کی درستت کرده|سازنده کیه|سازنده فاکسی مد کیه|کی فاکسی مد رو ساخته|فاکسی مد رو کی ساخته|کی برنامه رو ساخته|برنامه رو کی ساخته|برنامه نویست کیه|برنامه نویسش کیه|خالقت کیه|خالق تو کیه|کی خلقت کرده|کی تورو خلق کرده)$/i.test(lower) ||
            resemblesAny(['سازندت کیه', 'سازنده ت کیه', 'کی تورو ساخت', 'کی تورو ساخته'], 0.72);
        if (creatorQuestion) {
            creatorContactFollowupUntil = Date.now() + 20000;
            showVoiceResult('من رو محمدمهدی تقوی ساخته؛ یک پرستار که فاکسی‌مد رو برای سبک‌تر کردن کارهای روزمره همکارها ساخته. اگر دوست داری باهاش در ارتباط باشی، بگو «ارتباط با سازنده» یا فقط بگو «آره».', 'success');
            return true;
        }

        if (/^(?:ارتباط با سازنده|تماس با سازنده|تلگرام سازنده|راه ارتباط با سازنده|آیدی سازنده)$/i.test(lower)) {
            return openCreatorContact();
        }
        if (creatorContactFollowupUntil > Date.now() && /^(?:آره|بله|حتما|حتماً|باشه|اوکی)$/i.test(lower)) {
            return openCreatorContact();
        }
        if (creatorContactFollowupUntil > Date.now() && /^(?:نه|خیر|نه ممنون)$/i.test(lower)) {
            creatorContactFollowupUntil = 0;
            showVoiceResult('حتماً، هر وقت خواستی راه ارتباط در تنظیمات هست.', 'success');
            return true;
        }

        if (/^(?:اسم من چیه|منو چی صدا میکنی|من رو چی صدا میکنی)$/.test(lower)) {
            const userName = (localStorage.getItem('userName') || '').trim();
            showVoiceResult(userName
                ? userName + '؛ با همین اسم صدات می‌کنم.'
                : 'هنوز اسمت رو نمی‌دونم. می‌تونی از تنظیمات واردش کنی.', 'success');
            return true;
        }

        for (const pattern in SMALL_TALK) {
            if (new RegExp('(?:^|\\s)(?:' + pattern + ')(?=$|\\s)', 'i').test(lower)) {
                const replies = SMALL_TALK[pattern];
                showVoiceResult(replies[Math.floor(Math.random() * replies.length)], 'success');
                return true;
            }
        }
        return false;
    }

    // ============================================
    // MAIN ENTRY POINT
    // ============================================
    function process(text) {
        let normalized = PersianNumbers.toLatin(text);
        // Collapse ZWNJ (half-space, U+200C) into a regular space before
        // anything else. Persian speech-to-text output is inconsistent
        // about where it inserts a ZWNJ vs a regular space vs nothing at
        // all for the same phrase — "بی‌ام‌آی", "بی ام آی", and "بی‌ام ای"
        // (mixed) are all the same spoken words, but as plain strings they
        // don't match each other. Normalizing here means trigger phrases
        // only need to be listed once, with regular spaces, instead of
        // needing every separator permutation hand-typed out.
        normalized = normalizeTranscript(normalized);
        const heardTranscript = normalized;
        normalized = normalizeSpokenClinicalTerms(normalized);
        normalized = normalizeConversationalAsr(normalized);
        const lower = normalized.toLowerCase();
        confirmationSequence++;

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

        let textWithDigits = withAcronymsProtected(normalized, normalizeAndConvertNumbers);
        for (const persian in PERSIAN_UNIT_WORDS) {
            textWithDigits = textWithDigits.replace(new RegExp(persian, 'g'), PERSIAN_UNIT_WORDS[persian]);
        }

        const params = extractParams(textWithDigits);
        // Preserve what ASR actually returned for the clinical confirmation;
        // internal acronym normalization must never rewrite the audit text.
        params._heard = heardTranscript;

        const infoTriggers = ['اطلاعات', 'درباره', 'توضیح', 'شرح', 'کاربرد', 'مقدار مصرف', 'نحوه مصرف', 'چیه', 'چیست', 'info', 'about', 'describe'];
        let hasInfoTrigger = false;
        for (let i = 0; i < infoTriggers.length; i++) { if (lower.includes(infoTriggers[i])) { hasInfoTrigger = true; break; } }
        if (hasInfoTrigger) {
            const drugId = params.drugId || findDrugName(normalized);
            if (drugId) { dispatchCommand('druginfo', textWithDigits, { drugId: drugId }); return; }
        }

        if ((lower.includes('سطح بدن') || lower.includes('body surface')) && params.weight && params.height) {
            dispatchCommand('bsa', textWithDigits, params);
            return;
        }

        // Once a known medication has been identified, do not let the very
        // similar generic `drug`, `dose_calc`, and `druginfo` scores produce
        // an ambiguity message. Explicit information requests were handled
        // above; compatibility/Y-site phrases must continue to the two-drug
        // router below. Every remaining single-drug phrase safely opens the
        // main drug calculator behind clinical confirmation.
        const compatibilityContext = /(?:سازگاری|تداخل|همزمان|مخلوط|y[ -]?site|داخل یک سرم)/i.test(lower);
        if (params.drugId && !compatibilityContext) {
            dispatchCommand('drug', textWithDigits, params);
            return;
        }

        const isExplicitCancellation = /(?:^|\s)(?:no|نه|اشتباه|لغو)(?=$|\s)/i.test(lower);
        if (isExplicitCancellation && lastCommand) {
            showVoiceResult('دستور قبلی لغو شد. دوباره بگو چی لازم داری.', 'info');
            lastCommand = null;
            lastParams = null;
            return;
        }

        const scores = scoreCommand(textWithDigits, params);
        const sorted = Object.entries(scores).sort(function (a, b) { return b[1] - a[1]; });
        const best = sorted[0];

        if (!best || best[1] < 0.55) {
            if (params.weight && params.height) { dispatchCommand('bmi', textWithDigits, params); return; }
            logUnrecognizedPhrase(text, normalized);
            showVoiceResult('درست متوجه نشدم. یه‌بار واضح‌تر بگو یا یکی از نمونه‌ها رو بزن.', 'error');
            return;
        }

        const second = sorted[1];
        if (second && best[1] < 2.5 && best[1] - second[1] < 0.20) {
            const topPair = new Set([best[0], second[0]]);
            if (topPair.has('convert') && topPair.has('electrolyte')) {
                dispatchCommand(params.meq && params.electrolyte ? 'convert' : 'electrolyte', textWithDigits, params);
                return;
            }
            if (topPair.has('ysite') && topPair.has('compat_tool')) {
                dispatchCommand('ysite', textWithDigits, params);
                return;
            }
            const bodyMeasureTie = (best[0] === 'bmi' && second[0] === 'bsa') ||
                (best[0] === 'bsa' && second[0] === 'bmi');
            logUnrecognizedPhrase(text, normalized);
            showVoiceResult(bodyMeasureTie
                ? 'مطمئن نیستم منظورت BMI یا BSAـه؛ اسمش رو بگو.'
                : 'دو دستور شبیه هم پیدا کردم؛ اسم محاسبه رو واضح‌تر بگو.', 'info');
            return;
        }

        dispatchCommand(best[0], textWithDigits, params);
    }

    // ============================================
    // COMMAND EXECUTION
    // ============================================
    const CLINICAL_CONFIRM_COMMANDS = new Set([
        'drug', 'bmi', 'bsa', 'ibw', 'crcl', 'drip', 'convert',
        'electrolyte', 'percentage', 'unit_convert', 'temp_convert',
        'weight_convert', 'pressure_convert', 'dose_calc', 'gcs', 'rass', 'braden', 'morse', 'humpty',
        'burns', 'oxygen', 'vbg', 'ventilator', 'nutrition', 'ysite',
        'compat_tool'
    ]);

    const CONFIRM_LABELS = {
        drug: 'محاسبه دارو و دوز', bmi: 'محاسبه BMI', bsa: 'محاسبه BSA',
        ibw: 'محاسبه وزن ایده‌آل', crcl: 'محاسبه کلیرانس کراتینین',
        drip: 'محاسبه سرعت قطره', convert: 'تبدیل الکترولیت',
        electrolyte: 'تبدیل الکترولیت', percentage: 'محاسبه غلظت درصدی',
        unit_convert: 'تبدیل واحد', temp_convert: 'تبدیل دما',
        weight_convert: 'تبدیل وزن', pressure_convert: 'تبدیل فشار', dose_calc: 'محاسبه دوز',
        gcs: 'محاسبه GCS', rass: 'ثبت RASS', braden: 'محاسبه Braden',
        morse: 'محاسبه Morse', humpty: 'محاسبه Humpty Dumpty', burns: 'محاسبه درصد سوختگی', oxygen: 'محاسبه مدت اکسیژن',
        vbg: 'تفسیر گاز خون', ventilator: 'محاسبه ونتیلاتور',
        nutrition: 'محاسبه تغذیه', ysite: 'بررسی سازگاری Y-Site',
        compat_tool: 'بررسی سازگاری Y-Site'
    };

    // Recognition and navigation are separate from calculation. Once the
    // nurse confirms the transcript, always reveal the relevant calculator
    // even when required values are missing; the handler can then ask for
    // those values while the correct form is already visible.
    const COMMAND_TARGETS = {
        drug: { tab: 'calculator' },
        dose_calc: { tab: 'calculator' },
        bmi: { tab: 'tools', accordion: 'bmiAccordionItem' },
        bsa: { tab: 'tools', accordion: 'bsaAccordionItem' },
        ibw: { tab: 'tools', accordion: 'ibwAccordionItem' },
        crcl: { tab: 'tools', accordion: 'crclAccordionItem' },
        drip: { tab: 'tools', accordion: 'dripAccordionItem' },
        convert: { tab: 'tools', accordion: 'electrolyteAccordionItem' },
        electrolyte: { tab: 'tools', accordion: 'electrolyteAccordionItem' },
        percentage: { tab: 'tools', accordion: 'percentageAccordionItem' },
        unit_convert: { tab: 'tools', accordion: 'unitAccordionItem' },
        temp_convert: { tab: 'tools', accordion: 'tempAccordionItem' },
        weight_convert: { tab: 'tools', accordion: 'weightAccordionItem' },
        pressure_convert: { tab: 'tools', accordion: 'pressureAccordionItem' },
        gcs: { tab: 'tools', accordion: 'gcsAccordionItem' },
        rass: { tab: 'tools', accordion: 'rassAccordionItem' },
        braden: { tab: 'tools', accordion: 'bradenAccordionItem' },
        morse: { tab: 'tools', accordion: 'morseAccordionItem' },
        humpty: { tab: 'tools', accordion: 'humptyAccordionItem' },
        burns: { tab: 'tools', accordion: 'burnsAccordionItem' },
        oxygen: { tab: 'tools', accordion: 'oxygenAccordionItem' },
        vbg: { tab: 'tools', accordion: 'vbgAccordionItem' },
        ventilator: { tab: 'tools', accordion: 'ventilatorAccordionItem' },
        nutrition: { tab: 'tools', accordion: 'nutritionAccordionItem' },
        ysite: { tab: 'tools', accordion: 'ysiteAccordionItem' },
        compat_tool: { tab: 'tools', accordion: 'ysiteAccordionItem' }
    };

    function revealCommandTarget(cmd) {
        const target = COMMAND_TARGETS[cmd];
        if (!target) return;
        switchTab(target.tab);
        if (target.accordion) {
            setTimeout(function () { openAccordionById(target.accordion); }, 120);
        }
    }

    function formatConfirmationNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '';
        try { return number.toLocaleString('fa-IR', { maximumFractionDigits: 2 }); }
        catch (e) { return String(number); }
    }

    function confirmationDrugName(id) {
        const drug = id && drugDatabase[id];
        return drug ? (drug.persianName || drug.englishName || id) : '';
    }

    function formatDoseUnit(unit) {
        const units = { mg: 'میلی‌گرم', mcg: 'میکروگرم', g: 'گرم', units: 'واحد' };
        return units[String(unit || '').toLowerCase()] || String(unit || '');
    }

    function formatDosePhrase(params) {
        if (!params || !Number.isFinite(Number(params.dose))) return '';
        let phrase = formatConfirmationNumber(params.dose);
        if (params.doseUnit) phrase += ' ' + formatDoseUnit(params.doseUnit);
        if (params.ratePeriod === 'hour') phrase += ' در ساعت';
        else if (params.ratePeriod === 'minute') phrase += ' در دقیقه';
        return phrase;
    }

    function buildHistoryEntry(cmd, params) {
        params = params || {};
        const drugName = confirmationDrugName(params.drugId);
        const dosePhrase = formatDosePhrase(params);
        if (cmd === 'drug' && drugName) {
            const prefix = params.method === 'infusion' ? 'انفوزیون ' : 'محاسبه داروی ';
            const canonical = prefix + drugName + (dosePhrase ? ' — ' + dosePhrase : '');
            const replay = (params.method === 'infusion' ? 'انفوزیون ' : 'محاسبه دارو ') + drugName +
                (dosePhrase ? ' ' + dosePhrase : '');
            return { label: canonical, replay: replay };
        }

        if ((cmd === 'ysite' || cmd === 'compat_tool') && params.drug1 && params.drug2) {
            const first = confirmationDrugName(params.drug1);
            const second = confirmationDrugName(params.drug2);
            return { label: 'بررسی سازگاری ' + first + ' و ' + second, replay: 'سازگاری ' + first + ' و ' + second };
        }

        let label = CONFIRM_LABELS[cmd] || ({
            history: 'باز کردن تاریخچه', settings: 'باز کردن تنظیمات',
            tab_calculator: 'باز کردن ماشین‌حساب', tab_drugs: 'باز کردن مرجع داروها',
            tab_tools: 'باز کردن ابزارهای بالینی', manual_calc: 'باز کردن محاسبه دستی'
        })[cmd];
        if (!label) return null;
        if (cmd === 'bmi' && params.weight && params.height) {
            label += ' — وزن ' + formatConfirmationNumber(params.weight) + '، قد ' + formatConfirmationNumber(params.height);
        }
        return { label: label, replay: label };
    }

    function recordCompletedAction(cmd, params) {
        if (!window.VoiceUI || typeof window.VoiceUI.recordHistory !== 'function') return;
        const entry = buildHistoryEntry(cmd, params);
        if (entry) window.VoiceUI.recordHistory(entry.label, entry.replay);
    }

    // Present the canonical action that FoxiMed will execute, not the fuzzy
    // raw decoder transcript. This is safer for confirmation: the nurse
    // reviews the resolved drug/tool and parsed patient values directly.
    function buildConfirmationMessage(label, cmd, params) {
        params = params || {};
        const lines = ['عملیات: ' + label];
        const drugName = confirmationDrugName(params.drugId);
        if (drugName) lines.push('دارو: ' + drugName);
        const drug1 = confirmationDrugName(params.drug1);
        const drug2 = confirmationDrugName(params.drug2);
        if (drug1 && drug2) lines.push('داروها: ' + drug1 + ' + ' + drug2);
        if (params.method === 'infusion') lines.push('روش: پمپ انفوزیون');
        else if (params.method === 'syringe') lines.push('روش: پمپ سرنگ');
        if (params.solution) lines.push('محلول: ' + params.solution);
        if (params.weight) lines.push('وزن: ' + formatConfirmationNumber(params.weight) + ' کیلوگرم');
        if (params.height) lines.push('قد: ' + formatConfirmationNumber(params.height) + ' سانتی‌متر');
        if (params.age) lines.push('سن: ' + formatConfirmationNumber(params.age) + ' سال');
        if (params.gender === 'female') lines.push('جنسیت: زن');
        else if (params.gender === 'male') lines.push('جنسیت: مرد');
        if (params.ampoules) lines.push('تعداد آمپول: ' + formatConfirmationNumber(params.ampoules));
        if (params.customAmount && params.customUnit) {
            lines.push('مقدار: ' + formatConfirmationNumber(params.customAmount) + ' ' + params.customUnit);
        }
        const dosePhrase = formatDosePhrase(params);
        if (dosePhrase) lines.push('دوز/دستور: ' + dosePhrase);
        if (params.flow) lines.push('جریان: ' + formatConfirmationNumber(params.flow) + ' لیتر در دقیقه');
        if (params.rassScore !== undefined) lines.push('امتیاز RASS: ' + formatConfirmationNumber(params.rassScore));
        if (params.bradenScores) lines.push('امتیازهای Braden: ' + params.bradenScores.map(formatConfirmationNumber).join('، '));
        if (params.morseScores) lines.push('امتیازهای Morse: ' + params.morseScores.map(formatConfirmationNumber).join('، '));
        if (params.humptyScores) lines.push('امتیازهای Humpty Dumpty: ' + params.humptyScores.map(formatConfirmationNumber).join('، '));
        if (lines.length === 1) lines.push('برای باز کردن ابزار و ورود یا بررسی مقادیر، تأیید کنید.');
        return lines.join(' · ');
    }

    function dispatchCommand(cmd, text, params) {
        if (!CLINICAL_CONFIRM_COMMANDS.has(cmd)) {
            executeCommand(cmd, text, params);
            recordCompletedAction(cmd, params);
            return;
        }

        if (!window.VoiceUI || typeof window.VoiceUI.showConfirmation !== 'function') {
            showVoiceResult('برای ایمنی، اجرای این محاسبه به تأیید دستی نیاز دارد.', 'error');
            return;
        }

        const requestId = confirmationSequence;
        const label = CONFIRM_LABELS[cmd] || 'محاسبه بالینی';
        window.VoiceUI.showConfirmation(
            buildConfirmationMessage(label, cmd, params),
            function () {
                if (requestId !== confirmationSequence) return;
                revealCommandTarget(cmd);
                executeCommand(cmd, text, params);
                recordCompletedAction(cmd, params);
            },
            function () {
                if (requestId !== confirmationSequence) return;
                showVoiceResult('دستور لغو شد و هیچ محاسبه‌ای اجرا نشد.', 'info');
            }
        );
    }

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
            case 'settings':
                // Bare "تنظیمات" (settings) with no more specific dark/
                // light/font wording already handled earlier in process()
                // — just open the settings panel itself. This command was
                // already being correctly recognized/scored, but had no
                // actual case here, so it fell through to the generic
                // "not supported yet" message despite being "understood".
                if (DOM.settingsModal) {
                    DOM.settingsModal.classList.add('active');
                    document.body.classList.add('no-scroll');
                }
                showVoiceResult('تنظیمات باز شد', 'success');
                break;
            case 'help':
                showVoiceResult('می‌تونم محاسبه‌گر دارو یا ابزار بالینی موردنظرت رو باز کنم، عددهایی که می‌گی رو وارد کنم، اطلاعات و سازگاری داروها رو پیدا کنم و تم یا اندازه نوشته رو تغییر بدم. مثلاً بگو: «انفوزیون هپارین»، «BMI وزن ۷۵ قد ۱۷۵»، «قطره ۵۰۰ میلی‌لیتر در ۸ ساعت»، «هامپی دامپی»، «درصد سوختگی»، «اکسیژن ۵ لیتر فشار ۱۵۰ بار جریان ۴»، «گلاسکو ۴ ۵ ۶»، «سازگاری هپارین و وانکومایسین» یا «حالت تاریک». دستورهای بالینی رو فقط بعد از تأییدت اجرا می‌کنم.', 'info');
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
            case 'humpty': handleHumptyVoice(params); break;
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
            case 'pressure_convert':
                switchTab('tools');
                setTimeout(function () {
                    openAccordionForTool('pressureResult', 'pressureAccordionItem');
                }, 300);
                showVoiceResult('مبدل فشار باز شد؛ مقدار را در یکی از واحدها وارد کنید.', 'success');
                break;
            case 'dose_calc':
                // NOTE: this command previously called populateDoseCalcFromDrug()
                // and calculateDose(), which reference DOM elements
                // (doseNeeded, doseVialVolume, etc.) that don't exist
                // anywhere in index.html — a standalone "vial dose"
                // calculator that's referenced in JS but was apparently
                // never actually built out in the UI. Calling it always
                // threw an error regardless of platform. Rather than
                // fabricate a clinical calculation flow that hasn't been
                // reviewed, this now degrades honestly instead of
                // crashing or falsely claiming success.
                showVoiceResult('این ابزار هنوز آماده نیست. برای محاسبه دوز، از بخش محاسبه اصلی استفاده کنید.', 'info');
                break;
            case 'compat_tool':
                // Redirects to the real, working Y-site compatibility
                // checker (see the 'ysite' case) instead of the old
                // checkCompatibility()/compatDrug1/compatDrug2 flow, which
                // referenced DOM elements that no longer exist since the
                // Y-site tool was rebuilt as the chip-based multi-drug
                // matrix — this old function was never removed, so any
                // phrasing that happened to score higher on 'compat_tool'
                // than 'ysite' would silently crash instead of using the
                // feature that's actually there.
                handleYSiteVoice(text, params);
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
            showVoiceResult('اسم دارو رو نگرفتم؛ یه‌بار واضح‌تر بگو.', 'error');
            return;
        }

        selectDrug(drugId);
        const drug = drugDatabase[drugId];

        if (params.method) {
            document.querySelectorAll('.method-selector-compact .method-btn-compact').forEach(function (btn) {
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
            showVoiceResult('مقدار دوز رو نگرفتم؛ دوز رو هم بگو.', 'error');
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
        if (!drugId) { showVoiceResult('اسم دارو مشخص نیست؛ اسمش رو هم بگو.', 'error'); return; }
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

        const w = params.weight || 0;
        const h = params.height || 0;
        if (!w || !h) { showVoiceResult('وزن و قد رو هم بگو؛ مثلاً «BMI وزن ۷۵ قد ۱۷۵».', 'error'); return; }

        function applyValuesAndCalculate() {
            const weightInput = document.getElementById('bmiWeight');
            const heightInput = document.getElementById('bmiHeight');
            if (!weightInput || !heightInput) return;
            weightInput.value = w;
            heightInput.value = h;
            ['input', 'change'].forEach(function (eventName) {
                try {
                    weightInput.dispatchEvent(new Event(eventName, { bubbles: true }));
                    heightInput.dispatchEvent(new Event(eventName, { bubbles: true }));
                } catch (e) {}
            });
            calculateBMI();
        }

        // Apply immediately, then once more after the accordion transition.
        // Mobile Safari can finish the tab's default-field initialization a
        // frame later, which previously restored 70/170 after voice parsing.
        applyValuesAndCalculate();
        setTimeout(function () {
            openAccordionById('bmiAccordionItem');
            applyValuesAndCalculate();
            const result = document.getElementById('bmiResult');
            const msg = result ? 'BMI محاسبه شد: ' + (result.textContent || result.innerText) : 'BMI محاسبه شد';
            showVoiceResult(msg, 'success');
        }, 300);
    }

    function handleBSAVoice(params) {
        const w = params.weight || 0;
        const h = params.height || 0;
        if (!w || !h) { showVoiceResult('وزن و قد رو هم بگو؛ مثلاً «سطح بدن وزن ۷۰ قد ۱۷۰».', 'error'); return; }
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
        if (!age || !w || !cr) { showVoiceResult('سن، وزن و کراتینین رو هم بگو.', 'error'); return; }
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
        if (!vol || !time) { showVoiceResult('حجم و زمان رو هم بگو؛ مثلاً «قطره ۵۰۰ میلی‌لیتر در ۸ ساعت».', 'error'); return; }
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
        if (!e || !v || !m) { showVoiceResult('سه عدد GCS رو هم بگو؛ مثلاً «گلاسکو ۴ ۵ ۶».', 'error'); return; }

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
            showVoiceResult('عدد RASS رو بین ۵- تا ۴ بگو؛ مثلاً «RASS 2».', 'error');
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
            showVoiceResult('۶ عدد برادن رو به‌ترتیب بگو: حس، رطوبت، فعالیت، تحرک، تغذیه و اصطکاک.', 'info');
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
            showVoiceResult('۶ عدد مورس رو به‌ترتیب بگو: سابقه سقوط، تشخیص ثانویه، وسیله کمکی، IV، راه رفتن و وضعیت ذهنی.', 'info');
            return;
        }
        const domains = ['fallHistory', 'secDiag', 'aid', 'iv', 'gait', 'mental'];
        domains.forEach(function (d, i) {
            document.querySelectorAll('.gcs-btn[data-morse="' + d + '"]').forEach(function (btn) { if (parseInt(btn.dataset.score) === scores[i]) btn.click(); });
        });
        showVoiceResult('مقیاس مورس تنظیم شد', 'success');
    }

    function handleHumptyVoice(params) {
        switchTab('tools');
        setTimeout(function () { openAccordionById('humptyAccordionItem'); }, 300);

        const scores = params.humptyScores;
        if (!scores || scores.length !== 7) {
            showVoiceResult('۷ عدد هامپی دامپی رو به‌ترتیب بگو: سن، جنس، تشخیص، شناخت، محیط، جراحی یا سدیشن و داروها.', 'info');
            return;
        }

        const domains = ['age', 'gender', 'diagnosis', 'cognition', 'environment', 'sedation', 'medication'];
        const allowed = [[1, 2, 3, 4], [1, 2], [1, 2, 3, 4], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3], [1, 2, 3]];
        if (scores.some(function (score, index) { return !allowed[index].includes(score); })) {
            showVoiceResult('یکی از امتیازهای هامپی دامپی خارج از محدوده معتبره؛ لطفاً گزینه‌ها رو داخل کارت انتخاب کن.', 'error');
            return;
        }

        domains.forEach(function (domain, index) {
            document.querySelectorAll('.gcs-btn[data-humpty="' + domain + '"]').forEach(function (btn) {
                if (parseInt(btn.dataset.score) === scores[index]) btn.click();
            });
        });
        showVoiceResult('مقیاس هامپی دامپی تنظیم شد', 'success');
    }

    function handleBurnsVoice(text) {
        switchTab('tools');
        showVoiceResult('بخش سوختگی رو باز کردم؛ ناحیه‌های سوخته رو روی تصویر بزن.', 'info');
        if (text.includes('کودک') || text.includes('pediatric')) setBurnsAge('pediatric');
        else setBurnsAge('adult');
        setTimeout(function () { openAccordionById('burnsAccordionItem'); }, 300);
    }

    function handleOxygenVoice(params) {
        const size = params.liters || 0;
        const pressure = params.pressure || 0;
        const flow = params.flow || 0;
        if (!size || !pressure || !flow) {
            showVoiceResult('حجم کپسول، فشار و جریان رو هم بگو؛ مثلاً «اکسیژن ۵ لیتر فشار ۱۵۰ بار جریان ۴».', 'error');
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
            showVoiceResult('pH، pCO₂ و HCO₃ رو هم بگو؛ مثلاً «VBG pH 7.4 pCO2 45 HCO3 24».', 'error');
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
        if (!height) { showVoiceResult('قد بیمار رو هم بگو؛ مثلاً «ونتیلاتور قد ۱۷۵ مرد».', 'error'); return; }
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
            showVoiceResult('وزن، قد و سن رو هم بگو؛ مثلاً «تغذیه وزن ۷۰ قد ۱۷۵ سن ۵۰ مرد».', 'error');
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
            showVoiceResult('اسم هر دو دارو رو بگو؛ مثلاً «سازگاری هپارین و وانکومایسین».', 'error');
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
        // Full names didn't match — try just the first/most distinctive
        // word of each multi-word name (e.g. "انسولین" alone for the
        // canonical "انسولین رگولار").
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName].concat(drug.alternativeNames || []);
            for (let i = 0; i < names.length; i++) {
                const word = firstSignificantWord(names[i]);
                if (word && lower.includes(word.toLowerCase())) return id;
            }
        }
        // Still nothing — try fuzzy, Persian-script names only.
        let bestId = null;
        let bestScore = 0;
        for (const id in drugDatabase) {
            const drug = drugDatabase[id];
            const names = [drug.persianName].concat(drug.alternativeNames || [])
                .filter(function (n) { return /[\u0600-\u06FF]/.test(n); });
            names.forEach(function (n) {
                const score = bestFuzzyScoreInText(lower, n.replace(/\s+/g, ''));
                if (score > bestScore) { bestScore = score; bestId = id; }
            });
        }
        return bestScore >= FUZZY_THRESHOLD ? bestId : null;
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

    // ============================================
    // LOCAL LEARNING LOG (honest scope)
    // There is no server here, and no legally-usable cloud service for an
    // Iran-based app (see the earlier conversation about sanctions
    // blocking essentially every major cloud provider) — so genuine
    // automatic cross-user learning isn't something this app can honestly
    // claim. What this DOES do, entirely on-device with zero new
    // infrastructure: remember phrases the assistant genuinely failed to
    // understand, so you (Mehdi) can periodically ask a nurse to export
    // this list (button lives in Settings, exports as plain text — easy
    // to paste into a Telegram/WhatsApp message) and use it as a REAL,
    // grounded list of what to add to the drug database, COMMAND_KEYWORDS,
    // or SMALL_TALK next — instead of guessing what phrasing people
    // actually use. Manual review step is deliberate: a wrong automatic
    // "fix" in a clinical dosing tool is a worse failure mode than a
    // missed voice command that falls back to typing.
    // ============================================
    const UNRECOGNIZED_LOG_KEY = 'foximed_voice_unrecognized_log';
    const UNRECOGNIZED_LOG_MAX = 200;

    function logUnrecognizedPhrase(original, normalized) {
        try {
            const log = JSON.parse(localStorage.getItem(UNRECOGNIZED_LOG_KEY) || '[]');
            log.push({ text: original, normalized: normalized, at: new Date().toISOString() });
            while (log.length > UNRECOGNIZED_LOG_MAX) log.shift();
            localStorage.setItem(UNRECOGNIZED_LOG_KEY, JSON.stringify(log));
        } catch (e) { /* localStorage full/unavailable — non-fatal, just skip logging */ }
    }

    function getUnrecognizedLog() {
        try { return JSON.parse(localStorage.getItem(UNRECOGNIZED_LOG_KEY) || '[]'); } catch (e) { return []; }
    }

    function clearUnrecognizedLog() {
        try { localStorage.removeItem(UNRECOGNIZED_LOG_KEY); } catch (e) {}
    }

    function exportUnrecognizedLogAsText() {
        const log = getUnrecognizedLog();
        if (log.length === 0) return 'هیچ عبارت درک‌نشده‌ای ثبت نشده است.';
        const lines = log.map(function (entry, i) {
            const date = new Date(entry.at);
            const dateStr = isNaN(date.getTime()) ? '' : date.toLocaleDateString('fa-IR') + ' ' + date.toLocaleTimeString('fa-IR');
            return (i + 1) + '. «' + entry.text + '»  —  ' + dateStr;
        });
        return 'عبارات درک‌نشده توسط دستیار صوتی FoxiMed (' + log.length + ' مورد):\n\n' + lines.join('\n');
    }

    window.VoiceCommands = {
        process: process,
        getUnrecognizedLog: getUnrecognizedLog,
        clearUnrecognizedLog: clearUnrecognizedLog,
        exportUnrecognizedLogAsText: exportUnrecognizedLogAsText
    };
})(window);
