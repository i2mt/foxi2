// ============================================
// FoxiMed — Medical Calculator PWA
// © 2026 Mohammad Mahdi Taghavi. All rights reserved.
//
// License: CC BY-NC 4.0
// You may share and adapt this work for non-commercial purposes
// with appropriate credit. Commercial use is prohibited.
// https://creativecommons.org/licenses/by-nc/4.0/
//
// Contact: https://t.me/i_2mt
// ============================================

// ============================================
// CONVERTER FUNCTIONS
// ============================================

// Electrolyte Converter with Sodium Bicarbonate support
function convertElectrolyte() {
    const element = document.getElementById('electrolyteElement').value;
    const value = parseFloat(document.getElementById('electrolyteValue').value);
    const fromUnit = document.getElementById('electrolyteFrom').value;
    const resultDiv = document.getElementById('electrolyteResult');
    
    if (!value || isNaN(value)) {
        showToast('خطا', 'مقدار را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    // Factors: mEq to mg for each element/compound
    const factors = {
        sodium: { mEqToMg: 23, mgTomEq: 0.0435 },
        potassium: { mEqToMg: 39, mgTomEq: 0.0256 },
        calcium: { mEqToMg: 20, mgTomEq: 0.05 },
        magnesium: { mEqToMg: 12, mgTomEq: 0.0833 },
        sodium_bicarbonate: { mEqToMg: 84, mgTomEq: 0.0119 }  // NaHCO3 MW = 84
    };
    
    const factor = factors[element];
    let result, unit, formula;
    
    if (fromUnit === 'mEq') {
        result = value * factor.mEqToMg;
        unit = 'mg';
        formula = `${value} mEq × ${factor.mEqToMg} =`;
    } else {
        result = value * factor.mgTomEq;
        unit = 'mEq';
        formula = `${value} mg × ${factor.mgTomEq} =`;
    }
    
    resultDiv.innerHTML = `
        ${formula}<br>
        <strong>${result.toFixed(2)} ${unit}</strong>
    `;
    resultDiv.style.display = 'block';
}

// Percentage Converter
function convertPercentage() {
    const percentage = parseFloat(document.getElementById('percentageValue').value);
    const volume = parseFloat(document.getElementById('percentageVolume').value);
    const resultDiv = document.getElementById('percentageResult');
    
    if (!percentage || !volume || isNaN(percentage) || isNaN(volume)) {
        showToast('خطا', 'مقادیر را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    const mgPerMl = percentage * 10;
    const totalMg = mgPerMl * volume;
    
    resultDiv.innerHTML = `
        ${percentage}% محلول:<br>
        <strong>${mgPerMl.toFixed(2)} mg/ml</strong><br>
        ${totalMg.toFixed(2)} mg in ${volume} ml
    `;
    resultDiv.style.display = 'block';
}

// Unit Converter
function convertUnits() {
    const fromUnit = document.getElementById('unitFrom').value;
    const toUnit = document.getElementById('unitTo').value;
    const value = parseFloat(document.getElementById('unitValue').value);
    const resultDiv = document.getElementById('unitResult');
    
    if (!value || isNaN(value)) {
        showToast('خطا', 'مقدار را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    const conversions = {
        mcg: { mg: 0.001, g: 0.000001, units: null },
        mg: { mcg: 1000, g: 0.001, units: null },
        g: { mcg: 1000000, mg: 1000, units: null },
        units: { mcg: null, mg: null, g: null }
    };
    
    if (fromUnit === toUnit) {
        resultDiv.innerHTML = `${value} ${fromUnit}`;
        resultDiv.style.display = 'block';
        return;
    }
    
    if (conversions[fromUnit] && conversions[fromUnit][toUnit] !== null) {
        const result = value * conversions[fromUnit][toUnit];
        resultDiv.innerHTML = `
            ${value} ${fromUnit} = <br>
            <strong>${result.toFixed(4)} ${toUnit}</strong>
        `;
        resultDiv.style.display = 'block';
    } else {
        resultDiv.innerHTML = 'تبدیل برای این واحدها تعریف نشده است';
        resultDiv.style.display = 'block';
    }
}

// Drip Rate Calculator
function calculateDripRate() {
    const volume = parseFloat(document.getElementById('dripVolume').value);
    const time = parseFloat(document.getElementById('dripTime').value);
    const dropFactor = parseFloat(document.getElementById('dripFactor').value);
    const resultDiv = document.getElementById('dripResult');
    
    if (!volume || !time || isNaN(volume) || isNaN(time)) {
        showToast('خطا', 'مقادیر را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    if (time === 0) {
        resultDiv.innerHTML = 'زمان نمی‌تواند صفر باشد';
        resultDiv.style.display = 'block';
        return;
    }
    
    const mlPerHour = volume / time;
    const dropsPerMin = (mlPerHour * dropFactor) / 60;
    
    resultDiv.innerHTML = `
        سرعت تزریق:<br>
        <strong>${mlPerHour.toFixed(1)} ml/ساعت</strong><br>
        <strong>${dropsPerMin.toFixed(1)} drops/min</strong>
    `;
    resultDiv.style.display = 'block';
}

// BMI Calculator
function calculateBMI() {
    const weight = parseFloat(document.getElementById('bmiWeight').value);
    const height = parseFloat(document.getElementById('bmiHeight').value);
    const resultDiv = document.getElementById('bmiResult');
    
    if (!weight || !height || isNaN(weight) || isNaN(height)) {
        showToast('خطا', 'مقادیر را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    if (height === 0) {
        resultDiv.innerHTML = 'قد نمی‌تواند صفر باشد';
        resultDiv.style.display = 'block';
        return;
    }
    
    const heightM = height / 100;
    const bmi = weight / (heightM * heightM);
    
    let category, color, interpretation;
    if (bmi < 18.5) {
        category = 'کم‌وزن';
        color = '#f59e0b';
        interpretation = 'نیاز به افزایش وزن';
    } else if (bmi < 24.9) {
        category = 'طبیعی';
        color = '#10b981';
        interpretation = 'وزن ایده‌آل';
    } else if (bmi < 29.9) {
        category = 'اضافه وزن';
        color = '#f59e0b';
        interpretation = 'نیاز به کاهش وزن';
    } else if (bmi < 34.9) {
        category = 'چاقی درجه ۱';
        color = '#ef4444';
        interpretation = 'خطر متوسط';
    } else if (bmi < 39.9) {
        category = 'چاقی درجه ۲';
        color = '#dc2626';
        interpretation = 'خطر بالا';
    } else {
        category = 'چاقی مفرط';
        color = '#991b1b';
        interpretation = 'خطر بسیار بالا';
    }
    
    const idealMin = 18.5 * (heightM * heightM);
    const idealMax = 24.9 * (heightM * heightM);
    
    resultDiv.innerHTML = `
        BMI: <strong style="color: ${color}">${bmi.toFixed(1)}</strong><br>
        وضعیت: <strong>${category}</strong><br>
        ${interpretation}<br>
        وزن ایده‌آل: ${idealMin.toFixed(1)} تا ${idealMax.toFixed(1)} کیلوگرم
    `;
    resultDiv.style.display = 'block';
}

// Body Surface Area Calculator
function calculateBSA() {
    const weight = parseFloat(document.getElementById('bsaWeight').value);
    const height = parseFloat(document.getElementById('bsaHeight').value);
    const formula = document.getElementById('bsaFormula').value;
    const resultDiv = document.getElementById('bsaResult');
    
    if (!weight || !height || isNaN(weight) || isNaN(height)) {
        showToast('خطا', 'مقادیر را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    if (height === 0) {
        resultDiv.innerHTML = 'قد نمی‌تواند صفر باشد';
        resultDiv.style.display = 'block';
        return;
    }
    
    let bsa;
    switch(formula) {
        case 'mosteller':
            bsa = Math.sqrt((weight * height) / 3600);
            break;
        case 'dubois':
            bsa = 0.007184 * Math.pow(weight, 0.425) * Math.pow(height, 0.725);
            break;
        case 'haycock':
            bsa = 0.024265 * Math.pow(weight, 0.5378) * Math.pow(height, 0.3964);
            break;
        default:
            bsa = Math.sqrt((weight * height) / 3600);
    }
    
    resultDiv.innerHTML = `
        BSA: <strong>${bsa.toFixed(3)} متر مربع</strong><br>
        (با فرمول ${formula})
    `;
    resultDiv.style.display = 'block';
}

// Ideal Body Weight Calculator
function calculateIBW() {
    const height = parseFloat(document.getElementById('ibwHeight').value);
    const gender = document.getElementById('ibwGender').value;
    const formula = document.getElementById('ibwFormula').value;
    const resultDiv = document.getElementById('ibwResult');
    
    if (!height || isNaN(height)) {
        showToast('خطا', 'قد را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    let ibw;
    let heightInch = height / 2.54;
    
    switch(formula) {
        case 'devine':
            if (gender === 'male') ibw = 50 + 2.3 * (heightInch - 60);
            else ibw = 45.5 + 2.3 * (heightInch - 60);
            break;
        case 'robinson':
            if (gender === 'male') ibw = 52 + 1.9 * (heightInch - 60);
            else ibw = 49 + 1.7 * (heightInch - 60);
            break;
        case 'miller':
            if (gender === 'male') ibw = 56.2 + 1.41 * (heightInch - 60);
            else ibw = 53.1 + 1.36 * (heightInch - 60);
            break;
        default:
            if (gender === 'male') ibw = 50 + 2.3 * (heightInch - 60);
            else ibw = 45.5 + 2.3 * (heightInch - 60);
    }
    
    resultDiv.innerHTML = `
        وزن ایده‌آل: <strong>${ibw.toFixed(1)} کیلوگرم</strong><br>
        (برای ${gender === 'male' ? 'مرد' : 'زن'}، فرمول ${formula})
    `;
    resultDiv.style.display = 'block';
}

// Creatinine Clearance Calculator
function calculateCrCl() {
    const age = parseFloat(document.getElementById('crclAge').value);
    const weight = parseFloat(document.getElementById('crclWeight').value);
    const creatinine = parseFloat(document.getElementById('crclValue').value);
    const gender = document.getElementById('crclGender').value;
    const resultDiv = document.getElementById('crclResult');
    
    if (!age || !weight || !creatinine || isNaN(age) || isNaN(weight) || isNaN(creatinine)) {
        showToast('خطا', 'همه مقادیر را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    if (creatinine === 0) {
        resultDiv.innerHTML = 'کراتینین نمی‌تواند صفر باشد';
        resultDiv.style.display = 'block';
        return;
    }
    
    let crcl;
    if (gender === 'male') {
        crcl = ((140 - age) * weight) / (72 * creatinine);
    } else {
        crcl = ((140 - age) * weight) / (72 * creatinine) * 0.85;
    }
    
    let interpretation;
    if (crcl > 90) interpretation = 'عملکرد کلیه طبیعی';
    else if (crcl > 60) interpretation = 'اختلال خفیف کلیوی';
    else if (crcl > 30) interpretation = 'اختلال متوسط کلیوی';
    else if (crcl > 15) interpretation = 'اختلال شدید کلیوی';
    else interpretation = 'نارسایی کلیه';
    
    resultDiv.innerHTML = `
        CrCl: <strong>${crcl.toFixed(1)} ml/min</strong><br>
        ${interpretation}<br>
        (فرمول Cockcroft-Gault)
    `;
    resultDiv.style.display = 'block';
}

// Compatibility Checker
function checkCompatibility() {
    const drug1 = document.getElementById('compatDrug1').value;
    const drug2 = document.getElementById('compatDrug2').value;
    const solution = document.getElementById('compatSolution').value;
    const resultDiv = document.getElementById('compatResult');
    
    if (!drug1 || !drug2) {
        showToast('خطا', 'هر دو دارو را انتخاب کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    if (drug1 === drug2) {
        resultDiv.innerHTML = `
            <strong style="color: #10b981;">همان دارو است</strong><br>
            سازگاری کامل
        `;
        resultDiv.style.display = 'block';
        return;
    }
    
    const incompatiblePairs = [
        ['heparin', 'amoxicillin'],
        ['heparin', 'phenobarbital'],
        ['furosemide', 'gentamicin'],
        ['furosemide', 'vancomycin'],
        ['norepinephrine', 'sodium bicarbonate']
    ];
    
    const isIncompatible = incompatiblePairs.some(pair => 
        (pair[0] === drug1 && pair[1] === drug2) || 
        (pair[0] === drug2 && pair[1] === drug1)
    );
    
    if (isIncompatible) {
        resultDiv.innerHTML = `
            <strong style="color: #ef4444;">⚠️ ناسازگار</strong><br>
            این داروها نباید از یک Y-Site تزریق شوند
        `;
    } else {
        resultDiv.innerHTML = `
            <strong style="color: #10b981;">✓ سازگار</strong><br>
            می‌توان از یک Y-Site تزریق کرد<br>
            (بررسی بیشتر توصیه می‌شود)
        `;
    }
    resultDiv.style.display = 'block';
}

// Dose Calculator
function calculateDose() {
    const needed = parseFloat(document.getElementById('doseNeeded').value);
    const concentration = parseFloat(document.getElementById('doseConcentration').value);
    const vialVolume = parseFloat(document.getElementById('doseVialVolume').value);
    const resultDiv = document.getElementById('doseResult');
    
    if (!needed || !concentration || !vialVolume || 
        isNaN(needed) || isNaN(concentration) || isNaN(vialVolume)) {
        showToast('خطا', 'همه مقادیر را وارد کنید', 'error');
        resultDiv.innerHTML = '';
        resultDiv.style.display = 'none';
        return;
    }
    
    if (concentration === 0) {
        resultDiv.innerHTML = 'غلظت نمی‌تواند صفر باشد';
        resultDiv.style.display = 'block';
        return;
    }
    
    const volumeNeeded = needed / concentration;
    const vialsNeeded = Math.ceil(volumeNeeded / vialVolume);
    
    if (volumeNeeded > vialVolume) {
        resultDiv.innerHTML = `
            حجم مورد نیاز: <strong>${volumeNeeded.toFixed(2)} ml</strong><br>
            تعداد ویال: <strong>${vialsNeeded} عدد</strong><br>
            <span style="color: #f59e0b;">نکته: نیاز به بیش از یک ویال است</span>
        `;
    } else {
        resultDiv.innerHTML = `
            حجم مورد نیاز: <strong>${volumeNeeded.toFixed(2)} ml</strong><br>
            یک ویال کافی است
        `;
    }
    resultDiv.style.display = 'block';
}

// Initialize compatibility dropdowns
function initCompatibilityDropdowns() {
    const drugSelect1 = document.getElementById('compatDrug1');
    const drugSelect2 = document.getElementById('compatDrug2');
    if (!drugSelect1 || !drugSelect2) return;
    
    drugSelect1.innerHTML = '<option value="">انتخاب دارو</option>';
    drugSelect2.innerHTML = '<option value="">انتخاب دارو</option>';
    
    Object.entries(drugDatabase).forEach(([id, drug]) => {
        const option1 = document.createElement('option');
        option1.value = id;
        option1.textContent = drug.persianName;
        drugSelect1.appendChild(option1);
        
        const option2 = document.createElement('option');
        option2.value = id;
        option2.textContent = drug.persianName;
        drugSelect2.appendChild(option2);
    });
}

// Initialize converters when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initCompatibilityDropdowns();
    
    // Add Enter key support for all converter inputs
    document.querySelectorAll('.converter-body input, .tool-body input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const card = input.closest('.converter-card, .tool-card');
                const button = card?.querySelector('.converter-btn, .tool-btn');
                if (button) button.click();
            }
        });
    });
});

// ============================================
// PRESSURE CONVERTER — bidirectional live
// ============================================
(function() {
    // All factors relative to 1 PSI
    const FROM_PSI = { psi: 1, mmhg: 51.7149, cmh2o: 70.3069, bar: 0.0689476, kpa: 6.89476 };
    const TO_PSI   = { psi: 1, mmhg: 1/51.7149, cmh2o: 1/70.3069, bar: 1/0.0689476, kpa: 1/6.89476 };
    const IDS      = { psi: 'pressurePSI', mmhg: 'pressureMMHG', cmh2o: 'pressureCMH2O', bar: 'pressureBAR', kpa: 'pressureKPA' };
    const DECIMALS = { psi: 3, mmhg: 1, cmh2o: 1, bar: 4, kpa: 3 };

    window.convertPressureLive = function(sourceUnit) {
        const sourceEl = document.getElementById(IDS[sourceUnit]);
        if (!sourceEl) return;
        const raw = sourceEl.value;
        const value = PersianNumbers ? PersianNumbers.parseNumber(raw) : parseFloat(raw);
        if (!raw || isNaN(value)) {
            Object.keys(IDS).forEach(u => { if (u !== sourceUnit) { const el = document.getElementById(IDS[u]); if (el) el.value = ''; } });
            return;
        }
        const valueInPSI = value * TO_PSI[sourceUnit];
        Object.keys(IDS).forEach(u => {
            if (u === sourceUnit) return;
            const el = document.getElementById(IDS[u]);
            if (!el) return;
            const converted = valueInPSI * FROM_PSI[u];
            el.value = converted.toFixed(DECIMALS[u]);
        });
    };
})();
