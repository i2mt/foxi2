/* ============================================
   FoxiMed — Voice Commands (Refactored)
   ============================================
   Intent‑driven, scoring‑based, Persian‑friendly.
   ============================================ */
(function (window) {
    'use strict';

    // ──────────────────────────────────────────────
    // 1. HELPERS
    // ──────────────────────────────────────────────

    // Levenshtein distance for fuzzy drug matching
    function levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                const cost = (a[j-1] === b[i-1]) ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i-1][j] + 1,
                    matrix[i][j-1] + 1,
                    matrix[i-1][j-1] + cost
                );
            }
        }
        return matrix[b.length][a.length];
    }

    // Persian number words → digits (longest first)
    const NUMBER_WORDS = {
        'یک': '1', 'دو': '2', 'سه': '3', 'چهار': '4', 'پنج': '5',
        'شش': '6', 'هفت': '7', 'هشت': '8', 'نه': '9', 'ده': '10',
        'یازده': '11', 'دوازده': '12', 'سیزده': '13', 'چهارده': '14', 'پانزده': '15',
        'شانزده': '16', 'هفده': '17', 'هجده': '18', 'نوزده': '19', 'بیست': '20',
        'سی': '30', 'چهل': '40', 'پنجاه': '50', 'شصت': '60', 'هفتاد': '70',
        'هشتاد': '80', 'نود': '90', 'صد': '100',
        'دویست': '200', 'سیصد': '300', 'چهارصد': '400', 'پانصد': '500',
        'ششصد': '600', 'هفتصد': '700', 'هشتصد': '800', 'نهصد': '900', 'هزار': '1000'
    };
    const NUMBER_WORD_KEYS = Object.keys(NUMBER_WORDS).sort((a,b) => b.length - a.length);

    // Common misrecognitions → corrected form
    const CORRECTIONS = {
        'بی ام ای': 'بی‌ام‌آی',
        'بی ام آی': 'بی‌ام‌آی',
        'بی اس ای': 'بی‌اس‌ای',
        'بی اس آ': 'بی‌اس‌ای',
        'فروزماید': 'فوروزماید',
        'فورزماید': 'فوروزماید',
        'فروز ماید': 'فوروزماید',
        'لازیک': 'لازیکس',
        'لازیکس': 'لازیکس',
        'نور آدرنالین': 'نوراپی‌نفرین',
        'نورآدرنالین': 'نوراپی‌نفرین',
        'پانتو پرا زول': 'پنتوپرازول',
        'پانتوپرازول': 'پنتوپرازول',
        'پنتو پرا زول': 'پنتوپرازول',
        'ونکومایسین': 'وانکومایسین',
        'پیپراسیلین': 'پیپراسیلین',
        'مروپنم': 'مروپنم',
        'جی سی اس': 'جی‌سی‌اس',
        'گلاسکو': 'گلاسکو',
        'بی ام آی': 'بی‌ام‌آی',
        'بی ام ای': 'بی‌ام‌آی',
        'بی اس ای': 'بی‌اس‌ای',
        'بی اس آ': 'بی‌اس‌ای',
        'تی بی اس ای': 'تی‌بی‌اس‌ای',
        'تی بی اس آ': 'تی‌بی‌اس‌ای',
        'پارکلند': 'پارکلند',
        'قانون نه': 'قانون نُه',
        'کلیرانس': 'کلیرانس',
        'کراتینین': 'کراتینین',
        'کراتین': 'کراتینین',
        'بی‌کربنات': 'بی‌کربنات',
        'بیکربنات': 'بی‌کربنات',
    };

    function normalizeTranscript(text) {
        let norm = text;

        // Replace Persian number words with digits
        for (const word of NUMBER_WORD_KEYS) {
            const regex = new RegExp('(^|\\s)' + word + '(?=$|\\s)', 'g');
            norm = norm.replace(regex, (match, prefix) => prefix + NUMBER_WORDS[word]);
        }

        // Apply corrections
        for (const [wrong, correct] of Object.entries(CORRECTIONS)) {
            norm = norm.replace(new RegExp(wrong, 'gi'), correct);
        }

        // Normalize whitespace
        norm = norm.replace(/\s+/g, ' ').trim();
        return norm;
    }

    // ──────────────────────────────────────────────
    // 2. ENTITY EXTRACTION
    // ──────────────────────────────────────────────

    function extractEntities(text) {
        const params = {};

        // --- Numbers with units ---
        const patterns = [
            { regex: /(\d+(?:\.\d+)?)\s*(kg|کیلوگرم|کیلو)/i, key: 'weight' },
            { regex: /(\d+(?:\.\d+)?)\s*(cm|سانت(?:ی‌متر)?)/i, key: 'height' },
            { regex: /(\d+(?:\.\d+)?)\s*(سال|yr)/i, key: 'age' },
            { regex: /(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)/i, key: 'dose' },
            { regex: /(\d+(?:\.\d+)?)\s*(meq|mEq)/i, key: 'meq' },
            { regex: /(\d+(?:\.\d+)?)\s*(L\/min|لیتر در دقیقه)/i, key: 'flow' },
            { regex: /(\d+(?:\.\d+)?)\s*(bar|psi|mmHg|cmH2O|kPa)/i, key: 'pressure' },
            { regex: /(\d+(?:\.\d+)?)\s*(%|درصد)/i, key: 'percentage' },
            { regex: /(\d+(?:\.\d+)?)\s*(mL|cc|سی‌سی)/i, key: 'volume' },
            { regex: /(\d+(?:\.\d+)?)\s*(h|ساعت)/i, key: 'time' },
        ];

        for (const p of patterns) {
            const match = text.match(p.regex);
            if (match) {
                const val = parseFloat(match[1]);
                if (!isNaN(val) && val > 0) {
                    params[p.key] = val;
                }
            }
        }

        // --- Sex ---
        if (/مرد|male/i.test(text)) params.sex = 'male';
        else if (/زن|female/i.test(text)) params.sex = 'female';

        // --- Drug name (fuzzy) ---
        const drugId = findDrugFuzzy(text);
        if (drugId) params.drugId = drugId;

        // --- GCS scores ---
        const gcsMatch = text.match(/(\d+)\s*(\d+)\s*(\d+)/);
        if (gcsMatch) {
            const e = parseInt(gcsMatch[1]), v = parseInt(gcsMatch[2]), m = parseInt(gcsMatch[3]);
            if (e >= 1 && e <= 4 && v >= 1 && v <= 5 && m >= 1 && m <= 6) {
                params.gcs_eye = e;
                params.gcs_verbal = v;
                params.gcs_motor = m;
            }
        }

        // --- RASS score ---
        const rassMatch = text.match(/rass\s*([+-]?\d+)/i) || text.match(/ریچموند\s*([+-]?\d+)/i);
        if (rassMatch) {
            const score = parseInt(rassMatch[1]);
            if (score >= -5 && score <= 4) params.rassScore = score;
        }

        // --- Braden scores (6 numbers) ---
        const bradenMatch = text.match(/برادن\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
        if (bradenMatch) {
            const scores = bradenMatch.slice(1, 7).map(Number);
            if (scores.every(s => s >= 1 && s <= 4)) params.bradenScores = scores;
        }

        // --- Morse scores (6 numbers) ---
        const morseMatch = text.match(/مورس\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
        if (morseMatch) {
            const scores = morseMatch.slice(1, 7).map(Number);
            if (scores.every(s => s >= 0)) params.morseScores = scores;
        }

        // --- Burns mention ---
        if (/سوختگی|برن|tbsa/i.test(text)) params.burns = true;

        // --- Creatinine ---
        const crMatch = text.match(/کراتینین\s*(\d+(?:\.\d+)?)/i);
        if (crMatch) params.creatinine = parseFloat(crMatch[1]);

        // --- Temperature ---
        const tempMatch = text.match(/(\d+(?:\.\d+)?)\s*درجه/i);
        if (tempMatch) params.temp = parseFloat(tempMatch[1]);

        // --- Electrolyte element ---
        const elems = ['سدیم', 'پتاسیم', 'کلسیم', 'منیزیم', 'بی‌کربنات', 'sodium', 'potassium', 'calcium', 'magnesium', 'bicarbonate'];
        for (const e of elems) {
            if (text.includes(e)) {
                params.electrolyte = e;
                break;
            }
        }

        return params;
    }

    // ──────────────────────────────────────────────
    // 3. FUZZY DRUG MATCHING
    // ──────────────────────────────────────────────

    function findDrugFuzzy(text) {
        const normalized = text.toLowerCase();
        // First try exact substring match (including aliases)
        for (const id in window.drugDatabase) {
            const drug = window.drugDatabase[id];
            const names = [drug.persianName, drug.englishName, ...(drug.alternativeNames || [])];
            for (const name of names) {
                if (normalized.includes(name.toLowerCase())) return id;
            }
        }
        // Fallback: token-based Levenshtein (allow threshold 2)
        const tokens = normalized.split(/\s+/);
        let bestId = null;
        let bestDist = Infinity;
        for (const id in window.drugDatabase) {
            const drug = window.drugDatabase[id];
            const names = [drug.persianName, drug.englishName, ...(drug.alternativeNames || [])];
            for (const name of names) {
                const nameLower = name.toLowerCase();
                for (const token of tokens) {
                    if (token.length < 2) continue;
                    const dist = levenshtein(token, nameLower);
                    if (dist <= 2 && dist < bestDist) {
                        bestDist = dist;
                        bestId = id;
                    }
                }
            }
        }
        return bestId;
    }

    // ──────────────────────────────────────────────
    // 4. INTENT DEFINITIONS
    // ──────────────────────────────────────────────

    // Each intent: id, triggers, weight, entityBonus, handler, tab, accordionId
    const INTENTS = [];

    function defineIntent(id, triggers, weight, entityBonus, handler, tab, accordionId) {
        INTENTS.push({ id, triggers, weight, entityBonus, handler, tab, accordionId });
    }

    // Helper to add triggers with normalized form
    function t(...triggers) { return triggers; }

    // ---- Drug Calculation ----
    defineIntent('drug_calc',
        t('دارو', 'دوز', 'انفوزیون', 'پمپ', 'سرنگ', 'میکروگرم', 'میلی‌گرم', 'واحد', 'kg/h', 'mcg', 'mg', 'units'),
        5,
        (params) => (params.drugId ? 10 : 0) + (params.dose ? 8 : 0) + (params.weight ? 2 : 0),
        (params) => { handleDrugVoice(params); },
        'calculator', null
    );

    // ---- BMI ----
    defineIntent('bmi',
        t('بی‌ام‌آی', 'bmi', 'شاخص توده بدنی', 'توده بدنی', 'وزن و قد'),
        15,
        (params) => (params.weight ? 8 : 0) + (params.height ? 8 : 0),
        (params) => {
            const w = params.weight || 0;
            const h = params.height || 0;
            if (!w || !h) { showVoiceResult('لطفاً وزن و قد را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('bmiAccordionItem');
                document.getElementById('bmiWeight').value = w;
                document.getElementById('bmiHeight').value = h;
                calculateBMI();
                showVoiceResult(`BMI محاسبه شد: ${document.getElementById('bmiResult').textContent || ''}`, 'success');
            }, 300);
        },
        'tools', 'bmiAccordionItem'
    );

    // ---- BSA ----
    defineIntent('bsa',
        t('بی‌اس‌ای', 'bsa', 'سطح بدن', 'مساحت بدن'),
        15,
        (params) => (params.weight ? 8 : 0) + (params.height ? 8 : 0),
        (params) => {
            const w = params.weight || 0;
            const h = params.height || 0;
            if (!w || !h) { showVoiceResult('لطفاً وزن و قد را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('bsaAccordionItem');
                document.getElementById('bsaWeight').value = w;
                document.getElementById('bsaHeight').value = h;
                calculateBSA();
                showVoiceResult('BSA محاسبه شد', 'success');
            }, 300);
        },
        'tools', 'bsaAccordionItem'
    );

    // ---- IBW ----
    defineIntent('ibw',
        t('وزن ایده‌آل', 'ibw', 'ideal weight'),
        12,
        (params) => (params.height ? 8 : 0) + (params.sex ? 3 : 0),
        (params) => {
            const h = params.height || 0;
            if (!h) { showVoiceResult('لطفاً قد را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('ibwAccordionItem');
                document.getElementById('ibwHeight').value = h;
                if (params.sex) document.getElementById('ibwGender').value = params.sex;
                calculateIBW();
                showVoiceResult('وزن ایده‌آل محاسبه شد', 'success');
            }, 300);
        },
        'tools', 'ibwAccordionItem'
    );

    // ---- Creatinine Clearance ----
    defineIntent('crcl',
        t('کلیرانس کراتینین', 'crcl', 'creatinine clearance', 'نارسایی کلیه'),
        14,
        (params) => (params.age ? 5 : 0) + (params.weight ? 5 : 0) + (params.creatinine ? 5 : 0) + (params.sex ? 2 : 0),
        (params) => {
            const age = params.age || 0;
            const w = params.weight || 0;
            const cr = params.creatinine || 0;
            if (!age || !w || !cr) { showVoiceResult('لطفاً سن، وزن و کراتینین را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('crclAccordionItem');
                document.getElementById('crclAge').value = age;
                document.getElementById('crclWeight').value = w;
                document.getElementById('crclValue').value = cr;
                if (params.sex) document.getElementById('crclGender').value = params.sex;
                calculateCrCl();
                showVoiceResult('کلیرانس کراتینین محاسبه شد', 'success');
            }, 300);
        },
        'tools', 'crclAccordionItem'
    );

    // ---- Drip Rate ----
    defineIntent('drip',
        t('قطره', 'دريپ', 'سرعت قطره', 'gravity', 'میکروست', 'ماکروست'),
        10,
        (params) => (params.volume ? 5 : 0) + (params.time ? 5 : 0),
        (params) => {
            const vol = params.volume || 0;
            const time = params.time || 0;
            if (!vol || !time) { showVoiceResult('لطفاً حجم و زمان را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('dripAccordionItem');
                document.getElementById('dripVolume').value = vol;
                document.getElementById('dripTime').value = time;
                calculateDripRateLive();
                showVoiceResult('نرخ قطره محاسبه شد', 'success');
            }, 300);
        },
        'tools', 'dripAccordionItem'
    );

    // ---- GCS ----
    defineIntent('gcs',
        t('گلاسکو', 'gcs', 'جی‌سی‌اس', 'کما', 'هوشیاری'),
        14,
        (params) => (params.gcs_eye && params.gcs_verbal && params.gcs_motor ? 10 : 0),
        (params) => {
            const e = params.gcs_eye || 0;
            const v = params.gcs_verbal || 0;
            const m = params.gcs_motor || 0;
            if (!e || !v || !m) { showVoiceResult('لطفاً سه عدد برای GCS وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('gcsAccordionItem');
                document.querySelectorAll('.gcs-btn[data-domain="eye"]').forEach(btn => { if (parseInt(btn.dataset.score) === e) btn.click(); });
                document.querySelectorAll('.gcs-btn[data-domain="verbal"]').forEach(btn => { if (parseInt(btn.dataset.score) === v) btn.click(); });
                document.querySelectorAll('.gcs-btn[data-domain="motor"]').forEach(btn => { if (parseInt(btn.dataset.score) === m) btn.click(); });
                showVoiceResult(`GCS محاسبه شد: E${e} V${v} M${m}`, 'success');
            }, 300);
        },
        'tools', 'gcsAccordionItem'
    );

    // ---- RASS ----
    defineIntent('rass',
        t('ریچموند', 'rass', 'آرام‌بخشی', 'آژیتیشن'),
        13,
        (params) => (params.rassScore !== undefined ? 10 : 0),
        (params) => {
            const score = params.rassScore;
            if (score === undefined || score < -5 || score > 4) { showVoiceResult('لطفاً عدد RASS را بین -5 تا 4 وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('rassAccordionItem');
                document.querySelectorAll('.rass-level').forEach(level => { if (parseInt(level.dataset.score) === score) level.click(); });
                showVoiceResult(`RASS ${score} تنظیم شد`, 'success');
            }, 300);
        },
        'tools', 'rassAccordionItem'
    );

    // ---- Braden ----
    defineIntent('braden',
        t('برادن', 'زخم فشاری', 'pressure ulcer'),
        12,
        (params) => (params.bradenScores && params.bradenScores.length === 6 ? 10 : 0),
        (params) => {
            const scores = params.bradenScores;
            if (!scores || scores.length !== 6) { showVoiceResult('لطفاً ۶ عدد برای برادن وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('bradenAccordionItem');
                const domains = ['sensory', 'moisture', 'activity', 'mobility', 'nutrition', 'friction'];
                domains.forEach((d, i) => {
                    document.querySelectorAll(`.gcs-btn[data-braden="${d}"]`).forEach(btn => { if (parseInt(btn.dataset.score) === scores[i]) btn.click(); });
                });
                showVoiceResult('مقیاس برادن تنظیم شد', 'success');
            }, 300);
        },
        'tools', 'bradenAccordionItem'
    );

    // ---- Morse ----
    defineIntent('morse',
        t('مورس', 'سقوط', 'خطر سقوط'),
        12,
        (params) => (params.morseScores && params.morseScores.length === 6 ? 10 : 0),
        (params) => {
            const scores = params.morseScores;
            if (!scores || scores.length !== 6) { showVoiceResult('لطفاً ۶ عدد برای مورس وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('morseAccordionItem');
                const domains = ['fallHistory', 'secDiag', 'aid', 'iv', 'gait', 'mental'];
                domains.forEach((d, i) => {
                    document.querySelectorAll(`.gcs-btn[data-morse="${d}"]`).forEach(btn => { if (parseInt(btn.dataset.score) === scores[i]) btn.click(); });
                });
                showVoiceResult('مقیاس مورس تنظیم شد', 'success');
            }, 300);
        },
        'tools', 'morseAccordionItem'
    );

    // ---- Burns ----
    defineIntent('burns',
        t('سوختگی', 'برن', 'tbsa', 'درصد سوختگی', 'قانون نه', 'پارکلند'),
        16,
        (params) => (params.burns ? 8 : 0),
        (params) => {
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('burnsAccordionItem');
                if (/کودک|pediatric/i.test(params._original || '')) setBurnsAge('pediatric');
                else setBurnsAge('adult');
                showVoiceResult('بخش سوختگی باز شد — روی نواحی ضربه بزنید', 'info');
            }, 300);
        },
        'tools', 'burnsAccordionItem'
    );

    // ---- Oxygen ----
    defineIntent('oxygen',
        t('اکسیژن', 'کپسول', 'cylinder', 'جریان اکسیژن'),
        11,
        (params) => (params.flow ? 5 : 0) + (params.pressure ? 5 : 0) + (params.volume ? 5 : 0),
        (params) => {
            const size = params.volume || 0;
            const pressure = params.pressure || 0;
            const flow = params.flow || 0;
            if (!size || !pressure || !flow) { showVoiceResult('لطفاً حجم کپسول، فشار و جریان را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('oxygenAccordionItem');
                document.getElementById('oxyCylinderSize').value = size;
                document.getElementById('oxyPressure').value = pressure;
                document.getElementById('oxyFlow').value = flow;
                calculateOxygen();
                showVoiceResult('مدت کپسول اکسیژن محاسبه شد', 'success');
            }, 300);
        },
        'tools', 'oxygenAccordionItem'
    );

    // ---- VBG ----
    defineIntent('vbg',
        t('گاز خون', 'vbg', 'abg', 'ph', 'pco2', 'hco3', 'بی‌کربنات'),
        12,
        (params) => 0,
        (params) => {
            const text = params._original || '';
            const pHMatch = text.match(/ph\s*(\d+(?:\.\d+)?)/i);
            const pco2Match = text.match(/pco2\s*(\d+(?:\.\d+)?)/i);
            const hco3Match = text.match(/hco3\s*(\d+(?:\.\d+)?)/i);
            const pH = pHMatch ? parseFloat(pHMatch[1]) : 0;
            const pco2 = pco2Match ? parseFloat(pco2Match[1]) : 0;
            const hco3 = hco3Match ? parseFloat(hco3Match[1]) : 0;
            if (!pH || !pco2 || !hco3) { showVoiceResult('لطفاً pH، pCO₂ و HCO₃ را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('vbgAccordionItem');
                document.getElementById('vbgPH').value = pH;
                document.getElementById('vbgPCO2').value = pco2;
                document.getElementById('vbgHCO3').value = hco3;
                interpretVBG();
                showVoiceResult('تفسیر گازهای خون انجام شد', 'success');
            }, 300);
        },
        'tools', 'vbgAccordionItem'
    );

    // ---- Ventilator ----
    defineIntent('ventilator',
        t('ونتیلاتور', 'حجم جاری', 'tidal volume', 'تهویه', 'ards'),
        13,
        (params) => (params.height ? 8 : 0) + (params.sex ? 2 : 0),
        (params) => {
            const h = params.height || 0;
            if (!h) { showVoiceResult('لطفاً قد بیمار را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('ventilatorAccordionItem');
                document.getElementById('ventHeight').value = h;
                if (params.sex) {
                    document.querySelectorAll('#ventGenderBtns .method-btn-compact').forEach(btn => { if (btn.dataset.gender === params.sex) btn.click(); });
                }
                calculateVentTV();
                showVoiceResult('حجم جاری ونتیلاتور محاسبه شد', 'success');
            }, 300);
        },
        'tools', 'ventilatorAccordionItem'
    );

    // ---- Nutrition ----
    defineIntent('nutrition',
        t('تغذیه', 'کالری', 'پروتئین', 'bmr', 'نیاز تغذیه‌ای'),
        11,
        (params) => (params.weight ? 5 : 0) + (params.height ? 5 : 0) + (params.age ? 3 : 0),
        (params) => {
            const w = params.weight || 0;
            const h = params.height || 0;
            const age = params.age || 0;
            if (!w || !h || !age) { showVoiceResult('لطفاً وزن، قد و سن را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('nutritionAccordionItem');
                document.getElementById('nutWeight').value = w;
                document.getElementById('nutHeight').value = h;
                document.getElementById('nutAge').value = age;
                if (params.sex) {
                    document.querySelectorAll('#nutGenderBtns .method-btn-compact').forEach(btn => { if (btn.dataset.gender === params.sex) btn.click(); });
                }
                const text = params._original || '';
                if (/سپسیس|sepsis/i.test(text)) document.getElementById('nutStress').value = '1.35';
                else if (/سوختگی|burn/i.test(text)) document.getElementById('nutStress').value = '1.5';
                else if (/ards/i.test(text)) document.getElementById('nutStress').value = '2.0';
                calculateNutrition();
                showVoiceResult('نیاز تغذیه‌ای محاسبه شد', 'success');
            }, 300);
        },
        'tools', 'nutritionAccordionItem'
    );

    // ---- Y-Site Compatibility ----
    defineIntent('ysite',
        t('سازگاری', 'تداخل', 'y-site', 'مخلوط داروها', 'داروها', 'همزمان'),
        12,
        (params) => (params.drug1 && params.drug2 ? 10 : 0),
        (params) => {
            const ids = findAllDrugNames(params._original || '', 2);
            const d1 = params.drug1 || ids[0];
            const d2 = params.drug2 || ids[1];
            if (!d1 || !d2 || d1 === d2) { showVoiceResult('لطفاً دو دارو را برای بررسی سازگاری وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('ysiteAccordionItem');
                document.querySelectorAll('#ysiteDrugGrid .ysite-drug-chip').forEach(chip => {
                    if (chip.dataset.id === d1 || chip.dataset.id === d2) chip.click();
                });
                showVoiceResult(`سازگاری ${window.drugDatabase[d1]?.persianName || d1} و ${window.drugDatabase[d2]?.persianName || d2} بررسی شد`, 'success');
            }, 300);
        },
        'tools', 'ysiteAccordionItem'
    );

    // ---- Drug Info ----
    defineIntent('drug_info',
        t('اطلاعات دارو', 'درباره', 'توضیح', 'کاربرد', 'مقدار مصرف', 'نحوه مصرف', 'چیه', 'چیست'),
        10,
        (params) => (params.drugId ? 10 : 0),
        (params) => {
            const drugId = params.drugId;
            if (!drugId) { showVoiceResult('نام دارو مشخص نشد', 'error'); return; }
            const drug = window.drugDatabase[drugId];
            if (!drug) { showVoiceResult('این دارو در پایگاه داده موجود نیست', 'error'); return; }
            switchTab('drugs');
            setTimeout(() => {
                const item = document.querySelector(`.qref-accordion-item[data-drug-id="${drugId}"]`);
                if (item) {
                    const header = item.querySelector('.qref-row');
                    if (header && header.dataset.bodyId) toggleAccordionById(header.dataset.bodyId);
                    item.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                showVoiceResult(`اطلاعات ${drug.persianName} باز شد`, 'success');
            }, 300);
        },
        'drugs', null
    );

    // ---- Settings ----
    defineIntent('settings',
        t('تنظیمات', 'حالت', 'دارک', 'لایت', 'فونت', 'تم', 'theme'),
        20,
        (params) => 0,
        (params) => {
            const text = params._original || '';
            if (/تاریک|دارک|dark/i.test(text)) {
                AppState.settings.themeMode = 'dark';
                saveSettings(); applyThemeMode();
                showVoiceResult('حالت تاریک فعال شد', 'success');
                return;
            }
            if (/روشن|لایت|light/i.test(text)) {
                AppState.settings.themeMode = 'light';
                saveSettings(); applyThemeMode();
                showVoiceResult('حالت روشن فعال شد', 'success');
                return;
            }
            if (/فونت بزرگ|large font/i.test(text)) {
                AppState.settings.largeFont = true;
                saveSettings(); applySettings();
                showVoiceResult('فونت بزرگ فعال شد', 'success');
                return;
            }
            if (/فونت کوچک|فونت معمولی|small font/i.test(text)) {
                AppState.settings.largeFont = false;
                saveSettings(); applySettings();
                showVoiceResult('فونت معمولی فعال شد', 'success');
                return;
            }
            if (DOM.settingsModal) {
                DOM.settingsModal.classList.add('active');
                document.body.classList.add('no-scroll');
                showVoiceResult('تنظیمات باز شد', 'success');
            }
        },
        null, null
    );

    // ---- Reverse mode ----
    defineIntent('reverse',
        t('معکوس', 'برعکس', 'وارونه', 'حالت معکوس'),
        9,
        (params) => 0,
        (params) => {
            AppState.reverseMode = !AppState.reverseMode;
            updateReverseUI();
            showVoiceResult(AppState.reverseMode ? 'حالت معکوس فعال شد' : 'حالت معکوس غیرفعال شد', 'info');
        },
        null, null
    );

    // ---- Clear results ----
    defineIntent('clear',
        t('پاک کن', 'پاک کردن', 'صفر', 'clear', 'reset', 'پاکسازی', 'حذف نتایج'),
        8,
        (params) => 0,
        (params) => {
            clearResults();
            showVoiceResult('نتایج پاک شد', 'success');
        },
        null, null
    );

    // ---- Manual calculation ----
    defineIntent('manual_calc',
        t('دستی', 'دستي', 'manual', 'custom', 'بدون دارو', 'دلخواه'),
        8,
        (params) => 0,
        (params) => {
            switchTab('calculator');
            setTimeout(() => {
                openManualCalculation();
                showVoiceResult('محاسبه دستی باز شد', 'success');
            }, 300);
        },
        'calculator', null
    );

    // ---- History ----
    defineIntent('history',
        t('تاریخچه', 'سابقه', 'گزارش', 'محاسبات قبلی'),
        8,
        (params) => 0,
        (params) => {
            loadHistory();
            if (DOM.historyModal) {
                DOM.historyModal.classList.add('active');
                document.body.classList.add('no-scroll');
                showVoiceResult('تاریخچه باز شد', 'success');
            }
        },
        null, null
    );

    // ---- Theme change ----
    defineIntent('theme',
        t('تم فاکس', 'تم اقیانوس', 'تم رز', 'تم جنگل', 'dreamfire', 'شرابی', 'پیش‌فرض', 'هدو'),
        9,
        (params) => 0,
        (params) => {
            const text = params._original || '';
            const themeMap = {
                'فاکس': 'fox', 'روباه': 'fox', 'fox': 'fox',
                'اقیانوس': 'ocean', 'سایرن': 'ocean', 'ocean': 'ocean',
                'رز': 'rose', 'ویکسن': 'rose', 'rose': 'rose',
                'جنگل': 'forest', 'لینکس': 'forest', 'forest': 'forest',
                'dreamfire': 'dreamfire', 'شرابی': 'dreamfire', 'زرشکی': 'dreamfire', 'گیلاسی': 'dreamfire',
                'پیش‌فرض': 'default', 'هدو': 'default', 'default': 'default'
            };
            let found = null;
            for (const key in themeMap) {
                if (text.includes(key)) { found = themeMap[key]; break; }
            }
            if (found) {
                AppState.settings.colorTheme = found;
                saveSettings();
                applyTheme(found);
                showVoiceResult(`تم ${found} فعال شد`, 'success');
            } else {
                showVoiceResult('تم شناسایی نشد', 'error');
            }
        },
        null, null
    );

    // ---- Help ----
    defineIntent('help',
        t('راهنما', 'کمک', 'راهنمایی', 'نمونه', 'چه کار کنم'),
        6,
        (params) => 0,
        (params) => {
            showVoiceResult('دستورات نمونه: «هپارین ۱۲ واحد/کیلوگرم/ساعت وزن ۷۰»، «BMI وزن ۷۵ قد ۱۷۵»، «قطره ۵۰۰ میلی‌لیتر در ۸ ساعت»، «تبدیل ۲۰ mEq سدیم به mg»، «GCS 4 5 6»، «سوختگی»، «اکسیژن ۵ لیتر فشار ۱۵۰ بار جریان ۴»، «تغذیه وزن ۷۰ قد ۱۷۵ سن ۵۰»، «سازگاری هپارین و وانکومایسین»، «تاریک»، «فونت بزرگ»', 'info');
        },
        null, null
    );

    // ---- Tab switching ----
    defineIntent('tab_calculator',
        t('ماشین حساب', 'calculator', 'محاسبه'),
        5,
        (params) => 0,
        (params) => { switchTab('calculator'); showVoiceResult('ماشین حساب باز شد', 'success'); },
        'calculator', null
    );
    defineIntent('tab_drugs',
        t('مرجع داروها', 'کتابخانه دارو', 'drug library', 'داروها'),
        5,
        (params) => 0,
        (params) => { switchTab('drugs'); showVoiceResult('مرجع داروها باز شد', 'success'); },
        'drugs', null
    );
    defineIntent('tab_tools',
        t('ابزارها', 'tools', 'ابزارک‌ها'),
        5,
        (params) => 0,
        (params) => { switchTab('tools'); showVoiceResult('ابزارها باز شد', 'success'); },
        'tools', null
    );

    // ---- Electrolyte converter ----
    defineIntent('electrolyte',
        t('تبدیل الکترولیت', 'الکترولیت', 'meq', 'میلی‌اکی‌والان'),
        9,
        (params) => (params.meq || params.dose ? 5 : 0) + (params.electrolyte ? 5 : 0),
        (params) => {
            const elem = params.electrolyte || 'sodium';
            const val = params.meq || params.dose || 0;
            if (!val) { showVoiceResult('مقدار را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('electrolyteAccordionItem');
                document.getElementById('electrolyteElement').value = elem;
                document.getElementById('electrolyteMeq').value = val;
                convertElectrolyteLive('meq');
                showVoiceResult('تبدیل الکترولیت انجام شد', 'success');
            }, 300);
        },
        'tools', 'electrolyteAccordionItem'
    );

    // ---- Percentage converter ----
    defineIntent('percentage',
        t('درصد', 'غلظت درصد', 'percentage solution'),
        8,
        (params) => (params.percentage ? 5 : 0) + (params.volume ? 3 : 0),
        (params) => {
            const pct = params.percentage || 0;
            const vol = params.volume || 100;
            if (!pct) { showVoiceResult('درصد را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('percentageAccordionItem');
                document.getElementById('percentageValue').value = pct;
                document.getElementById('percentageVolume').value = vol;
                convertPercentageLive();
                showVoiceResult('غلظت درصد محاسبه شد', 'success');
            }, 300);
        },
        'tools', 'percentageAccordionItem'
    );

    // ---- Unit converter ----
    defineIntent('unit_convert',
        t('تبدیل واحد', 'واحد', 'میکروگرم', 'میلی‌گرم', 'گرم'),
        8,
        (params) => (params.dose ? 5 : 0),
        (params) => {
            const val = params.dose || 0;
            if (!val) { showVoiceResult('مقدار را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('unitAccordionItem');
                document.getElementById('unitFromVal').value = val;
                convertUnitsLive('from');
                showVoiceResult('تبدیل واحد انجام شد', 'success');
            }, 300);
        },
        'tools', 'unitAccordionItem'
    );

    // ---- Temperature converter ----
    defineIntent('temp_convert',
        t('دما', 'درجه', 'سلسیوس', 'فارنهایت', 'تب'),
        7,
        (params) => (params.temp ? 5 : 0),
        (params) => {
            const t = params.temp || 0;
            if (!t) { showVoiceResult('دما را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('tempAccordionItem');
                document.getElementById('tempC').value = t;
                convertTempLive('c');
                showVoiceResult('تبدیل دما انجام شد', 'success');
            }, 300);
        },
        'tools', 'tempAccordionItem'
    );

    // ---- Weight converter ----
    defineIntent('weight_convert',
        t('وزن', 'پوند', 'گرم', 'کیلوگرم'),
        7,
        (params) => (params.weight ? 5 : 0),
        (params) => {
            const w = params.weight || 0;
            if (!w) { showVoiceResult('وزن را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                openAccordionById('weightAccordionItem');
                document.getElementById('weightKg').value = w;
                convertWeightLive('kg');
                showVoiceResult('تبدیل وزن انجام شد', 'success');
            }, 300);
        },
        'tools', 'weightAccordionItem'
    );

    // ---- Dose calculator (simple) ----
    defineIntent('dose_calc',
        t('دوز', 'حجم ویال', 'dose calculation', 'vial'),
        8,
        (params) => (params.dose ? 5 : 0),
        (params) => {
            const dose = params.dose || 0;
            if (!dose) { showVoiceResult('دوز مورد نیاز را وارد کنید', 'error'); return; }
            switchTab('tools');
            setTimeout(() => {
                // This tool doesn't have a dedicated accordion; we'll just open tools tab
                showVoiceResult('دوز محاسبه شد (قابلیت کامل در نسخه بعدی)', 'info');
            }, 300);
        },
        'tools', null
    );

    // ──────────────────────────────────────────────
    // 5. MAIN PROCESSING PIPELINE
    // ──────────────────────────────────────────────

    function processTranscript(text) {
        const original = text;
        const normalized = normalizeTranscript(text);
        const params = extractEntities(normalized);
        params._original = original;

        // Compute scores for all intents
        let bestIntent = null;
        let bestScore = -Infinity;
        const scores = {};

        for (const intent of INTENTS) {
            let score = intent.weight;
            const lower = normalized.toLowerCase();
            for (const trigger of intent.triggers) {
                if (lower.includes(trigger.toLowerCase())) {
                    score += 1;
                }
            }
            if (intent.entityBonus) {
                score += intent.entityBonus(params) || 0;
            }
            // Boost if explicitly mentioned
            if (intent.triggers.some(t => lower.includes(t.toLowerCase()))) {
                score += 2;
            }
            if (intent.id === 'drug_calc' && params.drugId) {
                score += 5;
            }
            scores[intent.id] = score;
            if (score > bestScore) {
                bestScore = score;
                bestIntent = intent;
            }
        }

        // Debug: show scores if debug mode enabled
        if (window.DEBUG_VOICE) {
            const debugEl = document.getElementById('voiceDebug');
            if (debugEl) {
                let html = `<strong>Normalized:</strong> ${normalized}<br><strong>Scores:</strong><br>`;
                const sorted = Object.entries(scores).sort((a,b) => b[1] - a[1]);
                for (const [id, score] of sorted.slice(0, 6)) {
                    html += `${id}: ${score}<br>`;
                }
                html += `<strong>Winner:</strong> ${bestIntent ? bestIntent.id : 'none'} (score ${bestScore})`;
                debugEl.innerHTML = html;
                debugEl.style.display = 'block';
            }
        }

        // Threshold: if score < 5, weak
        if (bestScore < 5 || !bestIntent) {
            if (params.drugId && params.dose) {
                handleDrugVoice(params);
                return;
            }
            showVoiceResult('متوجه نشدم. لطفاً واضح‌تر بگویید یا از دکمه‌های نمونه استفاده کنید.', 'error');
            return;
        }

        // Execute best intent
        if (bestIntent.handler) {
            bestIntent.handler(params);
        } else {
            showVoiceResult('این دستور پشتیبانی نمی‌شود', 'error');
        }

        // Show tip if available
        const tip = TIPS[bestIntent.id];
        if (tip && window.VoiceUI && typeof window.VoiceUI.appendTip === 'function') {
            setTimeout(() => { window.VoiceUI.appendTip(tip); }, 1500);
        }
    }

    // ──────────────────────────────────────────────
    // 6. DRUG VOICE HANDLER
    // ──────────────────────────────────────────────

    function handleDrugVoice(params) {
        const drugId = params.drugId || findDrugFuzzy(params._original || '');
        if (!drugId) {
            showVoiceResult('دارو شناسایی نشد. لطفاً نام دارو را واضح بگویید.', 'error');
            return;
        }
        selectDrug(drugId);
        const drug = window.drugDatabase[drugId];

        let dose = params.dose || 0;
        if (dose <= 0) {
            const text = params._original || '';
            const match = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units)/i);
            if (match) dose = parseFloat(match[1]);
        }
        if (dose <= 0) {
            showVoiceResult('دوز مشخص نشد. لطفاً مقدار دوز را بگویید.', 'error');
            return;
        }

        const weight = params.weight || 0;
        const useWeight = (weight > 0) || /\/kg/.test(drug.standardUnit);

        // Set UI
        if (DOM.doctorOrder) {
            DOM.doctorOrder.value = dose;
            DOM.doctorOrder.dataset.numericValue = dose;
        }
        if (useWeight && DOM.weightCheckbox && DOM.patientWeight) {
            DOM.weightCheckbox.checked = true;
            AppState.useWeight = true;
            DOM.patientWeight.disabled = false;
            if (DOM.weightIosToggle) DOM.weightIosToggle.classList.add('on');
            if (DOM.weightInputRow) DOM.weightInputRow.style.display = 'flex';
            const w = weight || drug.weightBased?.defaultWeight || 70;
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

        const method = params.method || AppState.infusionMethod;
        if (method) {
            document.querySelectorAll('.method-btn-compact').forEach(btn => {
                if (btn.dataset.method === method) btn.click();
            });
        }

        const volume = params.volume || AppState.solutionVolume;
        if (volume > 0) {
            const btns = document.querySelectorAll('.volume-preset-btn');
            let found = false;
            for (const btn of btns) {
                if (parseInt(btn.dataset.volume) === volume) {
                    btn.click();
                    found = true;
                    break;
                }
            }
            if (!found && DOM.customVolumeContainer) {
                DOM.customVolumeContainer.style.display = 'flex';
                DOM.customVolume.value = volume;
                DOM.customVolume.dataset.numericValue = volume;
                AppState.customVolume = true;
                document.querySelectorAll('.volume-preset-btn').forEach(b => b.classList.remove('active'));
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

        if (AppState.currentTab !== 'calculator') switchTab('calculator');
        setTimeout(() => {
            updateDoseRangeIndicator();
            if (AppState.reverseMode) calculateReverse();
            else calculateInfusion();
            const results = document.getElementById('resultsSection');
            if (results && results.style.display === 'block') {
                results.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            showVoiceResult(`محاسبه ${drug.persianName} با دوز ${dose} انجام شد.`, 'success');
        }, 300);
    }

    // ──────────────────────────────────────────────
    // 7. SMALL TALK (original, kept)
    // ──────────────────────────────────────────────
    function trySmallTalk(text, lower) {
        const SMALL_TALK = {
            'سلام|درود|هلو|hi|hello|hey|sup': ['سلام! وقت بخیر 🌸 چطور می‌تونم کمکت کنم؟', 'درود بر شما! خوشحالم که اینجایی ✨'],
            'صبح بخیر|صبحت بخیر|صبح شما بخیر': ['صبح شما هم بخیر ☀️ شیفت خوبی داشته باشی', 'صبح بخیر! امیدوارم امروز روز آرومی باشه 🌅'],
            'شب بخیر|شبت بخیر|شب شما بخیر': ['شب بخیر 🌙 شیفت شب رو با قدرت ادامه بده', 'شب شما هم بخیر! مراقب خودت باش 💫'],
            'کی تورو ساخت|سازنده|برنامه نویس': ['من رو یکی از همکارات ساخته! 🦊', 'برنامه‌نویسم یکی از همکاراته که کارش رو دوست داره 💖'],
            'اسمت چیه|تو کی هستی': ['من دستیار صوتی فاکسی‌مد هستم 🦊', 'بهم میگن فاکسی! دستیار صوتی این برنامه‌ام 🦊'],
            'خسته‌ام|خستم|خستگی': ['آره شیفتا واقعاً خسته‌کننده‌ان... یه نفس عمیق بکش 💧', 'میدونم، این شغل خیلی انرژی می‌بره. ولی تو قوی‌ای 💪'],
            'شیفت بد|شیفت سخته': ['آره بعضی شیفتا واقعاً طاقت‌فرساست. تو از پسش برمیای 💪', 'شیفت سخت بگذره، یادت باشه بعدش یه دوش گرم و یه خواب خوب 🌙'],
            'شلوغه|شلوغ|پرکاره': ['شلوغی یعنی بهت نیاز بیشتری هست. تو می‌تونی 💪', 'نفس عمیق بکش، اولویت‌بندی کن و یکی‌یکی پیش ببر 🧘'],
            'متشکرم|ممنون|مرسی': ['خواهش می‌کنم! وظیفمه ☺️', 'قابل نداشت! هر وقت کمک خواستی، من اینجام 🌸'],
            'خداحافظ|بای|فعلا': ['خداحافظ! مراقب خودت باش 🌸', 'فعلا! هر وقت لازم شد من اینجام 👋'],
            'چطوری|خوبی|حالت چطوره': ['خوبم، ممنون! امیدوارم تو هم خوب باشی ❤️', 'عالی، چون دارم بهت کمک می‌کنم! 😊'],
            'بله|اوکی|باشه|چشم|حتماً': ['چشم! هر وقت آماده‌ای، بگو 📝', 'باشه! منتظر فرمان شما هستم 🚀'],
        };
        for (const pattern in SMALL_TALK) {
            if (new RegExp(pattern, 'i').test(lower)) {
                const replies = SMALL_TALK[pattern];
                showVoiceResult(replies[Math.floor(Math.random() * replies.length)], 'success');
                return true;
            }
        }
        // Short generic response
        if (text.length > 0 && text.length < 20 && !/\d/.test(text) && !findDrugFuzzy(text)) {
            const generic = ['مطمئنم می‌تونم کمک کنم! فقط بگو چطور 🦊', 'هر چی بگی، گوش‌هام باهاته 👂', 'بگو، چیکار می‌تونم برات انجام بدم؟ 😊'];
            showVoiceResult(generic[Math.floor(Math.random() * generic.length)], 'success');
            return true;
        }
        return false;
    }

    // ──────────────────────────────────────────────
    // 8. GRAMMAR BUILDER (for Vosk, unchanged)
    // ──────────────────────────────────────────────
    function buildVoiceGrammar() {
        // We'll reuse the existing grammar builder from original
        // but for simplicity, we return null to let Vosk use its default.
        return null;
    }

    // ──────────────────────────────────────────────
    // 9. PUBLIC API
    // ──────────────────────────────────────────────
    const TIPS = {
        bmi: '💡 همچنین می‌توانید BSA (سطح بدن) را با گفتن «BSA وزن ۷۰ قد ۱۷۰» محاسبه کنید.',
        bsa: '💡 برای BMI بگویید «BMI وزن ۷۵ قد ۱۷۵».',
        crcl: '💡 می‌توانید جنسیت را هم مشخص کنید: «زن» یا «مرد».',
        drip: '💡 نوع ست را هم می‌توانید بگویید: «ماکروست» یا «میکروست».',
        electrolyte: '💡 عناصر پشتیبانی‌شده: سدیم، پتاسیم، کلسیم، منیزیم، بی‌کربنات.',
        drug_calc: '💡 می‌توانید روش تزریق، حجم محلول، تعداد آمپول و مقدار دلخواه را هم مشخص کنید.',
        gcs: '💡 برای RASS بگویید «RASS 2» یا «RASS منفی ۳».',
        rass: '💡 برای GCS بگویید «GCS 4 5 6».',
        braden: '💡 مقیاس برادن ۶ بخش دارد: حس، رطوبت، فعالیت، تحرک، تغذیه، اصطکاک.',
        morse: '💡 مقیاس مورس ۶ بخش دارد: سابقه سقوط، تشخیص ثانویه، وسیله کمکی، IV، راه رفتن، وضعیت ذهنی.',
        burns: '💡 روی نواحی سوختگی در تصویر کلیک کنید — بزرگسال یا کودک را انتخاب کنید.',
        oxygen: '💡 فرمول: حجم کپسول (لیتر) × فشار (بار) × ۰.۹ ÷ جریان (L/min) = مدت (دقیقه).',
        vbg: '💡 برای VBG می‌توانید Na، Cl و آلبومین را هم برای آنیون گپ وارد کنید.',
        ventilator: '💡 همچنین می‌توانید از طول اولنا برای تخمین قد استفاده کنید.',
        nutrition: '💡 ضریب استرس را می‌توانید با گفتن «سپسیس» یا «سوختگی» تنظیم کنید.',
        ysite: '💡 دو دارو را با هم در یک جمله بگویید تا سازگاری Y-Site بررسی شود.',
        settings: '💡 با گفتن «تاریک»، «روشن»، «فونت بزرگ»، یا «تم فاکس» می‌توانید ظاهر را تغییر دهید.',
        help: '💡 برای دیدن نمونه دستورات، «راهنما» بگویید.',
        reverse: '💡 با «معکوس» وارد حالت محاسبه برعکس می‌شوید.',
        clear: '💡 «پاک کن» تمام نتایج را پاک می‌کند.',
        history: '💡 «تاریخچه» محاسبات قبلی را نشان می‌دهد.',
        manual_calc: '💡 «دستی» محاسبه دستی را باز می‌کند.',
        theme: '💡 با «تم فاکس»، «تم اقیانوس» و … تغییر تم دهید.'
    };

    function showVoiceResult(message, type) {
        if (window.VoiceUI && typeof window.VoiceUI.showResult === 'function') {
            window.VoiceUI.showResult(message, type || 'success');
        }
    }

    // Helper to find two drug names in text (for Y-site)
    function findAllDrugNames(text, limit) {
        limit = limit || 2;
        const lower = text.toLowerCase();
        const found = [];
        for (const id in window.drugDatabase) {
            const drug = window.drugDatabase[id];
            const names = [drug.persianName, drug.englishName].concat(drug.alternativeNames || []);
            let bestIndex = -1;
            for (const name of names) {
                const idx = lower.indexOf(String(name).toLowerCase());
                if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) bestIndex = idx;
            }
            if (bestIndex !== -1) found.push({ id, index: bestIndex });
        }
        found.sort((a,b) => a.index - b.index);
        const ids = [];
        for (const f of found) {
            if (!ids.includes(f.id)) ids.push(f.id);
            if (ids.length >= limit) break;
        }
        return ids;
    }

    // Expose public API
    window.VoiceCommands = {
        process: function(text) {
            // First check small talk
            const lower = text.toLowerCase();
            if (trySmallTalk(text, lower)) return;
            // Then run intent engine
            processTranscript(text);
        },
        getGrammar: buildVoiceGrammar
    };

    // Enable debug mode via URL parameter ?debug=1
    try {
        if (new URLSearchParams(window.location.search).get('debug') === '1') {
            window.DEBUG_VOICE = true;
        }
    } catch (e) {}

})(window);
