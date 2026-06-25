/* ============================================
   FoxiMed — Voice Commands (Direct & Reliable)
   ============================================ */
(function (window) {
    'use strict';

    // ------------------------------------------------------------
    // UTILITY: Show result (with fallback)
    // ------------------------------------------------------------
    function showVoiceResult(msg, type) {
        try {
            if (window.VoiceUI && typeof window.VoiceUI.showResult === 'function') {
                window.VoiceUI.showResult(msg, type || 'success');
            } else if (typeof showToast === 'function') {
                showToast(type || 'info', msg);
            } else {
                console.log('[Voice]', msg);
            }
        } catch (e) {
            console.error('[Voice] showVoiceResult error:', e);
        }
    }

    // ------------------------------------------------------------
    // DIRECT DRUG NAME MATCHER (exact substring, no fuzzy)
    // ------------------------------------------------------------
    function findDrugName(text) {
        const lower = text.toLowerCase();
        const drugMap = {
            'هپارین': 'heparin',
            'فوروزماید': 'lasix',
            'لازیکس': 'lasix',
            'لازیک': 'lasix',
            'فنتانیل': 'fentanyl',
            'میدازولام': 'midazolam',
            'ورسید': 'midazolam',
            'نوراپی نفرین': 'norepinephrine',
            'دوپامین': 'dopamine',
            'آمیودارون': 'amiodarone',
            'پنتوپرازول': 'pantoprazole',
            'لابتالول': 'labetalol',
            'اکترئوتاید': 'octreotide',
            'نیتروگلیسیرین': 'tng',
            'انسولین': 'insulin'
        };
        for (const [name, id] of Object.entries(drugMap)) {
            if (lower.includes(name)) return id;
        }
        // Also check drugDatabase
        if (typeof drugDatabase !== 'undefined') {
            for (const id in drugDatabase) {
                const drug = drugDatabase[id];
                const names = [drug.persianName, drug.englishName].concat(drug.alternativeNames || []);
                for (const n of names) {
                    if (lower.includes(n.toLowerCase())) return id;
                }
            }
        }
        return null;
    }

    // ------------------------------------------------------------
    // EXTRACT DOSE (number with or without unit)
    // ------------------------------------------------------------
    function extractDose(text) {
        let match = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|units|واحد)/i);
        if (match) return parseFloat(match[1]);
        match = text.match(/(\d+(?:\.\d+)?)/);
        if (match) return parseFloat(match[1]);
        return null;
    }

    // ------------------------------------------------------------
    // OPEN ACCORDION HELPER
    // ------------------------------------------------------------
    function openAccordion(bodyId) {
        const body = document.getElementById(bodyId);
        if (!body) return;
        const item = body.closest('.accordion-item');
        if (!item) return;
        // Close others
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

    // ------------------------------------------------------------
    // MAIN PROCESS
    // ------------------------------------------------------------
    function process(text) {
        if (!text || !text.trim()) return;
        const lower = text.toLowerCase();
        console.log('[Voice] Raw:', text);

        // ---- DIRECT TOOL COMMANDS ----

        // 1. Burns
        if (lower.includes('سوختگی') || lower.includes('درصد سوختگی')) {
            if (typeof switchTab === 'function') switchTab('tools');
            setTimeout(() => { openAccordion('burnsAccordionBody'); }, 100);
            showVoiceResult('بخش سوختگی باز شد', 'info');
            return;
        }

        // 2. BMI
        if (lower.includes('bmi') || lower.includes('بی ام ای') || lower.includes('شاخص توده')) {
            const w = text.match(/(\d+(?:\.\d+)?)\s*(kg|کیلو)/i);
            const h = text.match(/(\d+(?:\.\d+)?)\s*(cm|سانت)/i);
            if (typeof switchTab === 'function') switchTab('tools');
            setTimeout(() => {
                openAccordion('bmiAccordionBody');
                if (w) document.getElementById('bmiWeight').value = w[1];
                if (h) document.getElementById('bmiHeight').value = h[1];
                if (typeof calculateBMI === 'function') calculateBMI();
                showVoiceResult('BMI محاسبه شد', 'success');
            }, 300);
            return;
        }

        // 3. Oxygen
        if (lower.includes('اکسیژن') || lower.includes('کپسول')) {
            const size = text.match(/(\d+(?:\.\d+)?)\s*(L|لیتر)/i);
            const press = text.match(/(\d+(?:\.\d+)?)\s*(bar|بار)/i);
            const flow = text.match(/(\d+(?:\.\d+)?)\s*(L\/min|لیتر در دقیقه)/i);
            if (typeof switchTab === 'function') switchTab('tools');
            setTimeout(() => {
                openAccordion('oxygenAccordionBody');
                if (size) document.getElementById('oxyCylinderSize').value = size[1];
                if (press) document.getElementById('oxyPressure').value = press[1];
                if (flow) document.getElementById('oxyFlow').value = flow[1];
                if (typeof calculateOxygen === 'function') calculateOxygen();
                showVoiceResult('مدت کپسول اکسیژن محاسبه شد', 'success');
            }, 300);
            return;
        }

        // 4. VBG
        if (lower.includes('vbg') || lower.includes('وی بی جی') || lower.includes('گاز خون')) {
            const ph = text.match(/ph\s*(\d+(?:\.\d+)?)/i);
            const pco2 = text.match(/pco2\s*(\d+(?:\.\d+)?)/i);
            const hco3 = text.match(/hco3\s*(\d+(?:\.\d+)?)/i);
            if (typeof switchTab === 'function') switchTab('tools');
            setTimeout(() => {
                openAccordion('vbgAccordionBody');
                if (ph) document.getElementById('vbgPH').value = ph[1];
                if (pco2) document.getElementById('vbgPCO2').value = pco2[1];
                if (hco3) document.getElementById('vbgHCO3').value = hco3[1];
                if (typeof interpretVBG === 'function') interpretVBG();
                showVoiceResult('تفسیر گازهای خون انجام شد', 'success');
            }, 300);
            return;
        }

        // 5. GCS
        if (lower.includes('gcs') || lower.includes('گلاسکو')) {
            const nums = text.match(/(\d+)\s*(\d+)\s*(\d+)/);
            if (typeof switchTab === 'function') switchTab('tools');
            setTimeout(() => {
                openAccordion('gcsAccordionBody');
                if (nums) {
                    const domains = ['eye', 'verbal', 'motor'];
                    document.querySelectorAll('.gcs-btn').forEach(btn => {
                        const d = btn.dataset.domain;
                        const idx = domains.indexOf(d);
                        if (idx !== -1 && parseInt(btn.dataset.score) === parseInt(nums[idx+1])) {
                            btn.click();
                        }
                    });
                }
                showVoiceResult('GCS تنظیم شد', 'success');
            }, 300);
            return;
        }

        // 6. RASS
        if (lower.includes('rass') || lower.includes('ریچموند')) {
            const score = text.match(/([+-]?\d+)/);
            if (typeof switchTab === 'function') switchTab('tools');
            setTimeout(() => {
                openAccordion('rassAccordionBody');
                if (score) {
                    document.querySelectorAll('.rass-level').forEach(el => {
                        if (parseInt(el.dataset.score) === parseInt(score[1])) el.click();
                    });
                }
                showVoiceResult('RASS تنظیم شد', 'success');
            }, 300);
            return;
        }

        // 7. Nutrition
        if (lower.includes('تغذیه') || lower.includes('کالری') || lower.includes('nutrition')) {
            const w = text.match(/(\d+(?:\.\d+)?)\s*(kg|کیلو)/i);
            const h = text.match(/(\d+(?:\.\d+)?)\s*(cm|سانت)/i);
            const a = text.match(/(\d+(?:\.\d+)?)\s*(سال|age)/i);
            if (typeof switchTab === 'function') switchTab('tools');
            setTimeout(() => {
                openAccordion('nutritionAccordionBody');
                if (w) document.getElementById('nutWeight').value = w[1];
                if (h) document.getElementById('nutHeight').value = h[1];
                if (a) document.getElementById('nutAge').value = a[1];
                if (typeof calculateNutrition === 'function') calculateNutrition();
                showVoiceResult('نیاز تغذیه‌ای محاسبه شد', 'success');
            }, 300);
            return;
        }

        // ---- DRUG CALCULATION (only if a drug name is present) ----
        const drugId = findDrugName(text);
        if (drugId) {
            const dose = extractDose(text);
            console.log('[Voice] Drug:', drugId, 'Dose:', dose);

            // Select drug
            if (typeof selectDrug === 'function') {
                selectDrug(drugId);
            } else {
                console.warn('[Voice] selectDrug not available');
                showVoiceResult('خطا: تابع انتخاب دارو در دسترس نیست', 'error');
                return;
            }

            // Set dose if found
            if (dose && typeof DOM !== 'undefined' && DOM.doctorOrder) {
                DOM.doctorOrder.value = dose;
                DOM.doctorOrder.dataset.numericValue = dose;
                console.log('[Voice] Set dose to', dose);
            } else if (dose) {
                // Fallback: find the input directly
                const orderInput = document.getElementById('doctorOrder');
                if (orderInput) {
                    orderInput.value = dose;
                    orderInput.dataset.numericValue = dose;
                }
            }

            // Switch to calculator tab
            if (typeof switchTab === 'function') switchTab('calculator');

            // Wait for UI to settle then calculate
            setTimeout(() => {
                if (dose && typeof updateDoseRangeIndicator === 'function') {
                    updateDoseRangeIndicator();
                }
                // Re-apply dose in case it was cleared
                if (dose && DOM && DOM.doctorOrder) {
                    DOM.doctorOrder.value = dose;
                    DOM.doctorOrder.dataset.numericValue = dose;
                }
                if (typeof calculateInfusion === 'function') {
                    calculateInfusion();
                } else if (typeof calculateReverse === 'function') {
                    calculateReverse();
                }
                const drugName = (typeof drugDatabase !== 'undefined' && drugDatabase[drugId]) 
                    ? drugDatabase[drugId].persianName 
                    : drugId;
                showVoiceResult('محاسبه ' + drugName + (dose ? ' با دوز ' + dose : '') + ' انجام شد', 'success');
            }, 500);
            return;
        }

        // ---- FALLBACK ----
        showVoiceResult(
            'متوجه نشدم. لطفاً واضح‌تر بگویید یا از دکمه‌های نمونه استفاده کنید.\n' +
            'مثلاً: «هپارین ۸۰۰» یا «بی ام ای وزن ۷۰ قد ۱۷۵» یا «سوختگی»',
            'error'
        );
    }

    // ------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------
    window.VoiceCommands = {
        process: process,
        getGrammar: function() { 
            return '["هپارین","فوروزماید","لازیکس","بی ام ای","سوختگی","اکسیژن","وی بی جی"]'; 
        }
    };

    console.log('[Voice] VoiceCommands loaded (direct & reliable)');
})(window);
