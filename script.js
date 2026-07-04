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
// APP STATE & CONFIGURATION
// ============================================
const AppState = {
    selectedDrug: 'heparin',
    infusionMethod: 'syringe',
    solutionVolume: 50,
    ampouleCount: 2,
    customDrugAmount: null,
    useCustomDrugAmount: false,
    desiredDose: '',
    patientWeight: '',
    useWeight: false,
    currentAmpouleIndex: 0,
    theme: 'light',
    currentTab: 'calculator',
    calculationsToday: 0,
    customVolume: false,
    pwaInstallPrompt: null,
    settings: {
        darkMode: false,
        largeFont: false,
        doseAlerts: true,
        compatAlerts: true,
        saveHistory: true,
        hapticFeedback: true,
        colorTheme: 'fox',
        themeMode: 'light',
        voiceOutput: false
    },
    reverseMode: false
};

// ============================================
// LOADING SCREEN
// ============================================
(function setupLoadingScreen() {
    const steps = [
        { status: 'در حال بارگذاری پایگاه داده دارویی...', pct: 20 },
        { status: 'در حال راه‌اندازی ماشین حساب...', pct: 50 },
        { status: 'در حال اعمال تنظیمات...', pct: 75 },
        { status: 'آماده است!', pct: 100 }
    ];
    function applyThemeToLoadingScreen() {
    const loadingScreen = document.getElementById('loadingScreen');
    if (!loadingScreen) return;

    // Get saved settings
    let colorTheme = 'default';
    let isDark = false; // default to light
    try {
        const savedSettings = localStorage.getItem('appSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            colorTheme = settings.colorTheme || 'default';
            const themeMode = settings.themeMode || 'light';
            // Determine if dark mode should be active (honor auto)
            if (themeMode === 'dark') isDark = true;
            else if (themeMode === 'auto') {
                isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            } else {
                isDark = false;
            }
        } else {
            // Fallback: check legacy theme
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'dark') isDark = true;
        }
    } catch(e) { /* ignore */ }

    // Define theme gradients (same as in THEMES object but simplified for loading)
    const themeGradients = {
        default: { light: 'linear-gradient(145deg, #667eea 0%, #764ba2 100%)', dark: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)' },
        fox:     { light: 'linear-gradient(145deg, #f97316 0%, #dc2626 100%)', dark: 'linear-gradient(145deg, #2d1a11 0%, #1f0f0a 100%)' },
        ocean:   { light: 'linear-gradient(145deg, #0ea5e9 0%, #0d9488 100%)', dark: 'linear-gradient(145deg, #0c4a6e 0%, #0f3a3a 100%)' },
        rose:    { light: 'linear-gradient(145deg, #f43f5e 0%, #ec4899 100%)', dark: 'linear-gradient(145deg, #2d1321 0%, #1f0f18 100%)' },
        forest:  { light: 'linear-gradient(145deg, #22c55e 0%, #14b8a6 100%)', dark: 'linear-gradient(145deg, #14532d 0%, #115e59 100%)' }
    };

    const fallbackLight = 'linear-gradient(145deg, #667eea 0%, #764ba2 100%)';
    const fallbackDark  = 'linear-gradient(145deg, #1f2937 0%, #111827 100%)';

    let gradient = isDark ? fallbackDark : fallbackLight;
    if (themeGradients[colorTheme]) {
        gradient = isDark ? themeGradients[colorTheme].dark : themeGradients[colorTheme].light;
    }

    loadingScreen.style.background = gradient;
}

    let tipIndex = 0;
    function rotateTip() {
        const tips = document.querySelectorAll('.loading-tip');
        if (!tips.length) return;
        tips[tipIndex % tips.length].classList.remove('active');
        tipIndex = (tipIndex + 1) % tips.length;
        tips[tipIndex].classList.add('active');
    }

    window.loadingProgress = function(pct, status) {
        const bar    = document.getElementById('loadingBar');
        const stat   = document.getElementById('loadingStatus');
        if (bar)  bar.style.width  = pct + '%';
        if (stat) stat.textContent = status;
    };

    window.hideLoadingScreen = function() {
        const screen = document.getElementById('loadingScreen');
        if (!screen) return;
        screen.classList.add('fade-out');
        setTimeout(() => {
            screen.style.display = 'none';
            // Update theme-color to match actual app theme now that loading is done
            const meta = document.getElementById('themeColorMeta');
            if (meta) {
                const isDark = document.body.classList.contains('dark-mode');
                meta.content = isDark ? '#1f2937' : '#ffffff';
            }
        }, 550);
    };

    document.addEventListener('DOMContentLoaded', () => {
        applyThemeToLoadingScreen();
        const tipInterval = setInterval(rotateTip, 1800);
        let i = 0;
        function runStep() {
            if (i >= steps.length) {
                clearInterval(tipInterval);
                setTimeout(window.hideLoadingScreen, 300);
                return;
            }
            loadingProgress(steps[i].pct, steps[i].status);
            i++;
            setTimeout(runStep, i === steps.length ? 400 : 600);
        }
        setTimeout(runStep, 300);
    });
})();

// ============================================
// PWA INSTALL MODAL
// ============================================
(function setupPWAModal() {
    let deferredPrompt = null;

    function isIOS() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    }
    function isInStandaloneMode() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }
    function shouldShow() {
        if (isInStandaloneMode()) return false;
        if (localStorage.getItem('pwaNeverShow') === 'true') return false;
        const remind = localStorage.getItem('pwaRemindAfter');
        if (remind && Date.now() < parseInt(remind)) return false;
        return true;
    }
    function showModal() {
        if (!shouldShow()) return;
        const modal = document.getElementById('pwaModal');
        if (!modal) return;
        const androidNative = document.getElementById('pwaAndroidNative');
        const iosGuide      = document.getElementById('pwaIOSGuide');
        const genericGuide  = document.getElementById('pwaGenericGuide');
        if (deferredPrompt) {
            androidNative.style.display = 'block';
            iosGuide.style.display = 'none';
            genericGuide.style.display = 'none';
        } else if (isIOS()) {
            androidNative.style.display = 'none';
            iosGuide.style.display = 'block';
            genericGuide.style.display = 'none';
        } else {
            androidNative.style.display = 'none';
            iosGuide.style.display = 'none';
            genericGuide.style.display = 'block';
        }
        modal.style.display = 'flex';
    }
    function hideModal() {
        const modal = document.getElementById('pwaModal');
        if (modal) modal.style.display = 'none';
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        AppState.pwaInstallPrompt = e;
    });

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => { if (shouldShow()) showModal(); }, 3500);

        const installBtn = document.getElementById('pwaInstallBtn');
        if (installBtn) installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            hideModal();
            if (outcome === 'accepted') localStorage.setItem('pwaNeverShow', 'true');
        });

        const laterBtn = document.getElementById('pwaLaterBtn');
        if (laterBtn) laterBtn.addEventListener('click', () => {
            hideModal();
            localStorage.setItem('pwaRemindAfter', Date.now() + 172800000);
        });

        const neverBtn = document.getElementById('pwaNeverBtn');
        if (neverBtn) neverBtn.addEventListener('click', () => {
            hideModal();
            localStorage.setItem('pwaNeverShow', 'true');
        });

        const closeBtn = document.getElementById('pwaModalClose');
        if (closeBtn) closeBtn.addEventListener('click', hideModal);

        const overlay = document.getElementById('pwaModalOverlay');
        if (overlay) overlay.addEventListener('click', hideModal);
    });

    window.addEventListener('appinstalled', () => {
        hideModal();
        localStorage.setItem('pwaNeverShow', 'true');
    });
})();

// ============================================
// BIDIRECTIONAL TEXT SUPPORT
// ============================================
const TextDirection = {
    wrapLatin: function(text) {
        if (!text) return '';
        const hasLatin = /[A-Za-z0-9]/.test(text);
        if (hasLatin) return `\u202B${text}\u202C`;
        return text;
    },
    wrapPersian: function(text) {
        if (!text) return '';
        const hasRTL = /[\u0600-\u06FF]/.test(text);
        if (hasRTL) return `\u202B${text}\u202C`;
        return text;
    },
    fixMixedText: function(text) {
        if (!text) return '';
        const segments = this.splitByLanguage(text);
        return segments.map(segment => {
            if (segment.isLatin) return this.wrapLatin(segment.text);
            return segment.text;
        }).join('');
    },
    splitByLanguage: function(text) {
        const segments = [];
        let currentSegment = '';
        let currentIsLatin = null;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const isLatin = /[A-Za-z0-9.,\/;:!?@#$%^&*()_+\-=\[\]{}'"\\|<>]/.test(char);
            if (currentIsLatin !== isLatin && currentSegment !== '') {
                segments.push({ text: currentSegment, isLatin: currentIsLatin });
                currentSegment = '';
            }
            currentSegment += char;
            currentIsLatin = isLatin;
        }
        if (currentSegment !== '') segments.push({ text: currentSegment, isLatin: currentIsLatin });
        return segments;
    },
    formatDrugInfo: function(persian, latin) {
        if (!latin) return persian;
        if (!persian) return this.wrapLatin(latin);
        return `${persian}\u200F \u200E${this.wrapLatin(latin)}\u200F`;
    },
    createBilingualLabel: function(persianLabel, latinValue) {
        return `${persianLabel}:\u200F \u200E${this.wrapLatin(latinValue)}`;
    },
    applyBidiFixes: function() {
        document.querySelectorAll('.text-mixed, .text-latin, .drug-name-english').forEach(el => {
            el.style.unicodeBidi = 'isolate';
            el.style.direction = 'ltr';
        });
        document.querySelectorAll('.persian-text, .drug-name-compact, .selected-drug-name-compact').forEach(el => {
            el.style.unicodeBidi = 'isolate';
            el.style.direction = 'rtl';
        });
        document.querySelectorAll('input[type="number"], input[type="text"]').forEach(input => {
            input.style.unicodeBidi = 'plaintext';
        });
    }
};

// ============================================
// PERSIAN NUMBER SUPPORT
// ============================================
const PersianNumbers = {
    persianToLatin: {
        '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
        '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
        '٫':'.','٬':',','،':',','−':'-','–':'-','—':'-'
    },
    latinToPersian: {
        '0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹',
        '.':'٫',',':'٬'
    },
    toLatin: function(text) {
        if (!text) return '';
        return text.toString().split('').map(char => this.persianToLatin[char] || char).join('');
    },
    toPersian: function(text) {
        if (!text) return '';
        return text.toString().split('').map(char => this.latinToPersian[char] || char).join('');
    },
    parseNumber: function(text) {
        if (!text || text.toString().trim() === '') return NaN;
        let s = this.toLatin(text.toString()).trim();
        s = s.replace(/\s+/g, '');
        if (s.includes('.')) {
            s = s.replace(/,/g, '');
        } else if (s.includes(',')) {
            const thousandsPattern = /^-?\d{1,3}(,\d{3})+$/;
            if (thousandsPattern.test(s)) {
                s = s.replace(/,/g, '');
            } else {
                s = s.replace(',', '.');
                s = s.replace(/,/g, '');
            }
        }
        return parseFloat(s);
    },
    formatNumber: function(number, decimals = 2) {
        if (!Number.isFinite(number)) return '0';
        const d = parseInt(decimals, 10);
        const usedDecimals = Number.isFinite(d) ? d : 2;
        return number.toFixed(usedDecimals);
    },
    formatMixedText: function(text) {
        if (!text) return '';
        let formatted = this.toLatin(text.toString());
        formatted = TextDirection.fixMixedText(formatted);
        formatted = formatted.replace(/([A-Za-z][A-Za-z0-9\s.,\/;:!?@#$%^&*()_+\-=\[\]{}'"\\|<>]+)/g,
            match => `\u202B${match}\u202C`);
        return formatted;
    },
    parseMixed: function(text) {
        if (!text) return 0;
        let latinText = this.toLatin(text.toString());
        latinText = latinText.replace(/[^\d.\-]/g, '');
        return parseFloat(latinText) || 0;
    },
    bilingual: function(persian, latin, showBoth = true) {
        if (!showBoth || !latin) return persian;
        return `${persian}\u200F \u200E(${latin})\u200F`;
    }
};

// ============================================
// SIMPLE INPUT HANDLING
// ============================================
function renderDrugIcon(iconStr, extraStyle) {
    if (!iconStr) return '<i class="fas fa-pills"></i>';
    return `<i class="${iconStr}"${extraStyle ? ' style="' + extraStyle + '"' : ''}></i>`;
}

function setupSimpleInputHandling() {
    document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], textarea').forEach(input => {
        input.style.textAlign = 'center';
    });
    const style = document.createElement('style');
    style.textContent = `::placeholder { text-align: center !important; } input::placeholder { text-align: center !important; }`;
    document.head.appendChild(style);

    document.querySelectorAll('input[type="number"], input[type="text"].numeric-input').forEach(input => {
        input.addEventListener('focus', function() { this.select(); });
        input.addEventListener('click', function() { this.select(); });
    });

    const calculatorInputs = [
        DOM.doctorOrder, DOM.patientWeight, DOM.customVolume,
        document.getElementById('customAmountInput'),
        document.getElementById('manualDrugAmount'),
        document.getElementById('manualDesiredDose'),
        document.getElementById('manualPatientWeight'),
        document.getElementById('manualCustomVolume'),
    ].filter(Boolean);
    calculatorInputs.forEach(input => {
        if (!input) return;
        input.addEventListener('focus', function() { this.select(); });
        input.addEventListener('click', function() { this.select(); });
        input.addEventListener('input', function() {
            const before = this.value || '';
            const normalized = PersianNumbers.toLatin(before);
            if (normalized !== before) {
                const start = this.selectionStart;
                const end = this.selectionEnd;
                this.value = normalized;
                if (start != null && end != null) this.setSelectionRange(start, end);
            }
            const numValue = PersianNumbers.parseNumber(this.value);
            if (!isNaN(numValue)) this.dataset.numericValue = numValue;
            clearResults();
        });
        input.addEventListener('blur', function() {
            if (this.value && this.value.trim() !== '') {
                try {
                    const numValue = PersianNumbers.parseNumber(this.value);
                    if (!isNaN(numValue)) {
                        this.dataset.numericValue = numValue;
                        const decimalsAttr = this.getAttribute('data-decimals');
                        const decimals = decimalsAttr == null ? 2 : parseInt(decimalsAttr, 10);
                        const latinValue = PersianNumbers.formatNumber(numValue, Number.isFinite(decimals) ? decimals : 2);
                        if (this.value !== latinValue) this.value = latinValue;
                    }
                } catch (e) { /* keep original */ }
            }
        });
    });
}

// ============================================
// MOBILE NUMERIC KEYBOARD
// ============================================
function setupMobileNumericKeyboard() {
    document.querySelectorAll('input').forEach(input => {
        const type = input.type;
        const name = input.name || input.id || '';
        const isNumericField = type === 'number' || name.includes('dose') || name.includes('weight') ||
            name.includes('volume') || name.includes('count') || name.includes('value') ||
            name.includes('amount') || input.classList.contains('numeric-input') ||
            input.getAttribute('data-numeric') === 'true';

        if (isNumericField) {
            if (input.getAttribute('step') === '1' || name.includes('count') || name.includes('age') || name.includes('ampoule')) {
                input.setAttribute('inputmode', 'numeric');
                input.setAttribute('pattern', '[0-9]*');
            } else {
                input.setAttribute('inputmode', 'decimal');
                input.setAttribute('pattern', '[0-9]*[.,]?[0-9]*');
            }
            input.classList.add('numeric-keyboard');
            input.style.textAlign = 'center';
            input.addEventListener('input', function() {
                const before = this.value || '';
                const normalized = PersianNumbers.toLatin(before);
                if (normalized !== before) {
                    const start = this.selectionStart;
                    const end = this.selectionEnd;
                    this.value = normalized;
                    if (start != null && end != null) this.setSelectionRange(start, end);
                }
                const numValue = PersianNumbers.parseNumber(this.value);
                if (!isNaN(numValue)) this.dataset.numericValue = numValue;
            });
        }
    });
}

// ============================================
// HAPTIC FEEDBACK
// ============================================
function haptic(ms) {
    if (!AppState.settings.hapticFeedback) return;
    try { if (navigator.vibrate) navigator.vibrate(ms || 30); } catch(e) {}
}

// ============================================
// DOM ELEMENTS
// ============================================
const DOM = {
    themeToggle: document.getElementById('themeToggle'),
    historyBtn: document.getElementById('historyBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    drugGrid: document.getElementById('drugGrid'),
    drugSearch: document.getElementById('drugSearch'),
    selectedDrugIcon: document.getElementById('selectedDrugIcon'),
    selectedDrugName: document.getElementById('selectedDrugName'),
    selectedDrugDesc: document.getElementById('selectedDrugDesc'),
    methodBtns: document.querySelectorAll('.method-btn-compact'),
    volumeOptions: document.getElementById('volumeOptions'),
    customVolume: document.getElementById('customVolume'),
    customVolumeContainer: document.getElementById('customVolumeContainer'),
    ampouleCount: document.getElementById('ampouleCount'),
    ampouleCounterRow: document.getElementById('ampouleCounterRow'),
    customAmountToggle: document.getElementById('customAmountToggle'),
    customAmountToggleRow: document.getElementById('customAmountToggleRow'),
    customAmountIosToggle: document.getElementById('customAmountIosToggle'),
    customAmountToggleClickRow: document.getElementById('customAmountToggleClickRow'),
    customAmountToggleLabel: document.getElementById('customAmountToggleLabel'),
    customAmountInputRow: document.getElementById('customAmountInputRow'),
    customAmountInput: document.getElementById('customAmountInput'),
    customAmountUnit: document.getElementById('customAmountUnit'),
    customAmountPresets: document.getElementById('customAmountPresets'),
    decreaseAmpoule: document.getElementById('decreaseAmpoule'),
    increaseAmpoule: document.getElementById('increaseAmpoule'),
    ampouleInfo: document.getElementById('ampouleInfo'),
    doctorOrder: document.getElementById('doctorOrder'),
    weightContainer: document.getElementById('weightContainer'),
    weightCheckbox: document.getElementById('weightCheckbox'),
    patientWeight: document.getElementById('patientWeight'),
    weightIosToggle: document.getElementById('weightIosToggle'),
    weightInputRow: document.getElementById('weightInputRow'),
    calculateBtn: document.getElementById('calculateBtn'),
    calculateBtnWrap: document.getElementById('calculateBtnWrap'),
    resultsSection: document.getElementById('resultsSection'),
    totalDrugAmount: document.getElementById('totalDrugAmount'),
    totalDrugUnit: document.getElementById('totalDrugUnit'),
    concentrationResult: document.getElementById('concentrationResult'),
    concentrationUnit: document.getElementById('concentrationUnit'),
    pumpRateResult: document.getElementById('pumpRateResult'),
    pumpRateUnit: document.getElementById('pumpRateUnit'),
    durationResult: document.getElementById('durationResult'),
    durationUnit: document.getElementById('durationUnit'),
    guideSection: document.getElementById('guideSection'),
    stepByStepGuide: document.getElementById('stepByStepGuide'),
    warningsSection: document.getElementById('warningsSection'),
    warningsList: document.getElementById('warningsList'),
    compatibilitySection: document.getElementById('compatibilitySection'),
    compatibleDrugsList: document.getElementById('compatibleDrugsList'),
    incompatibleDrugsList: document.getElementById('incompatibleDrugsList'),
    settingsModal: document.getElementById('settingsModal'),
    historyModal: document.getElementById('historyModal'),
    closeSettings: document.getElementById('closeSettings'),
    closeHistory: document.getElementById('closeHistory'),
    largeFontToggle: document.getElementById('largeFontToggle'),
    doseAlertToggle: document.getElementById('doseAlertToggle'),
    compatAlertToggle: document.getElementById('compatAlertToggle'),
    saveHistoryToggle: document.getElementById('saveHistoryToggle'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    exportDataBtn: document.getElementById('exportDataBtn'),
    checkUpdateBtn: document.getElementById('checkUpdateBtn'),
    drugCount: document.getElementById('drugCount'),
    lastUpdate: document.getElementById('lastUpdate'),
    historyList: document.getElementById('historyList'),
    tabItems: document.querySelectorAll('.tab-item'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    librarySearch: document.getElementById('librarySearch'),
    openManualBtn: document.getElementById('openManual'),
    manualSection: document.getElementById('manualSection'),
    calculatorControls: document.getElementById('calculatorControls'),
    hapticToggle: document.getElementById('hapticToggle'),
    reverseCalcBtn: document.querySelector('.reverse-toggle-row'),
    reverseIosToggle: document.getElementById('reverseIosToggle'),
    reverseTooltip: document.getElementById('reverseTooltip'),
    doseRangeIndicator: document.getElementById('doseRangeIndicator'),
    doseRangeDot: document.getElementById('doseRangeDot'),
    doseRangeText: document.getElementById('doseRangeText'),
    dripRateRow: document.getElementById('dripRateRow'),
    dripRateResult: document.getElementById('dripRateResult'),
    dripRateLabel: document.getElementById('dripRateLabel'),
    themeModeSelect: null // removed from UI - theme-mode-btns handles this
};

// ============================================
// MOBILE LAYOUT
// ============================================
function setupMobileLayout() {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        fixTabVisibility();
        positionManualButtonInDrugGrid();
        fixDrugSidebar();
        ensureContentVisibility();
        if (DOM.calculatorControls) DOM.calculatorControls.style.display = 'grid';
        if (DOM.openManualBtn) DOM.openManualBtn.style.display = 'none';
        removeFloatingBars();
        setupMobileSearch();
        setupTouchFeedback();
        fixMethodButtonTextColor();
        TextDirection.applyBidiFixes();
        setupMobileNumericKeyboard();
        if (DOM.calculateBtnWrap) {
            DOM.calculateBtnWrap.style.position = 'sticky';
            DOM.calculateBtnWrap.style.bottom = '0';
            DOM.calculateBtnWrap.style.marginTop = 'auto';
        }
    } else {
        resetDesktopLayout();
    }
}

function clearMobileLayoutIssues() {}

function fixTabVisibility() {
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (!pane.classList.contains('active')) {
            pane.style.display = 'none';
        }
    });
    const activePane = document.querySelector('.tab-pane.active');
    if (activePane) activePane.style.display = 'block';
}

function fixDrugSidebar() {
    const drugSidebar = document.querySelector('.drug-sidebar');
    if (drugSidebar) drugSidebar.removeAttribute('style');
    const drugQuickSelect = document.querySelector('.drug-quick-select');
    if (drugQuickSelect) drugQuickSelect.removeAttribute('style');
    const drugScroll = document.querySelector('.drug-scroll-container');
    if (drugScroll) drugScroll.removeAttribute('style');
}

function removeFloatingBars() {
    const elementsToHide = [
        '.quick-actions-enhanced', '.quick-actions', '.action-btn-enhanced', '.action-btn',
        '.floating-bar', '.bottom-action-bar', '.overlay-bar', '#floatingBar', '#bottomBar'
    ];
    elementsToHide.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            el.style.opacity = '0';
            el.style.position = 'absolute';
            el.style.zIndex = '-100';
        });
    });
}

function ensureContentVisibility() {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.removeAttribute('style');
    const calculatorTab = document.getElementById('calculatorTab');
    if (calculatorTab) calculatorTab.removeAttribute('style');
    const calculatorLayout = document.querySelector('.calculator-layout');
    if (calculatorLayout) calculatorLayout.removeAttribute('style');
    const calculatorMain = document.querySelector('.calculator-main');
    if (calculatorMain) {
        calculatorMain.style.overflowY = 'auto';
        calculatorMain.style.webkitOverflowScrolling = 'touch';
    }
}

function fixVolumeButtonColors() {
    document.querySelectorAll('.volume-preset-btn.active').forEach(btn => {
        btn.style.setProperty('color', 'white', 'important');
        btn.querySelectorAll('.number, .unit-text, .custom-text, span').forEach(el => {
            el.style.setProperty('color', 'white', 'important');
        });
    });
    document.querySelectorAll('.volume-preset-btn:not(.active)').forEach(btn => {
        btn.style.removeProperty('color');
        btn.querySelectorAll('.number, .unit-text, .custom-text, span').forEach(el => {
            el.style.removeProperty('color');
        });
    });
}

function fixMethodButtonTextColor() {
    document.querySelectorAll('.method-btn-compact').forEach(button => {
        if (button.classList.contains('active')) {
            button.style.color = 'white';
            const icon = button.querySelector('i');
            const text = button.querySelector('span');
            if (icon) icon.style.color = 'white';
            if (text) text.style.color = 'white';
        } else {
            button.style.removeProperty('color');
            const icon = button.querySelector('i');
            const text = button.querySelector('span');
            if (icon) icon.style.removeProperty('color');
            if (text) text.style.removeProperty('color');
        }
    });
    fixVolumeButtonColors();
}

function positionManualButtonInDrugGrid() {
    const drugGrid = DOM.drugGrid;
    if (!drugGrid) return;
    const existingBtn = document.getElementById('openManualMobile');
    if (existingBtn) existingBtn.remove();
    const mobileManualBtn = document.createElement('div');
    mobileManualBtn.id = 'openManualMobile';
    mobileManualBtn.className = 'drug-item-compact';
    mobileManualBtn.innerHTML = `
        <div class="drug-icon-small" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
            <i class="fas fa-edit" style="color: white;"></i>
        </div>
        <div class="drug-name-compact" style="font-size: 10px; font-weight: 700;">محاسبه دستی</div>
    `;
    drugGrid.appendChild(mobileManualBtn);
    mobileManualBtn.addEventListener('click', openManualCalculation);
    mobileManualBtn.addEventListener('touchstart', function() { this.style.transform = 'scale(0.95)'; }, { passive: true });
    mobileManualBtn.addEventListener('touchend', function() { this.style.transform = ''; }, { passive: true });
}

function setupMobileSearch() {
    const mobileSearchToggle = document.getElementById('mobileSearchToggle');
    const drugSearchContainer = document.querySelector('.drug-search-container');
    if (mobileSearchToggle && drugSearchContainer) {
        mobileSearchToggle.addEventListener('click', () => {
            drugSearchContainer.style.display = drugSearchContainer.style.display === 'none' ? 'block' : 'none';
        });
    }
}

function setupTouchFeedback() {
    document.querySelectorAll('button, .drug-item-compact, .tab-item').forEach(element => {
        element.addEventListener('touchstart', function() {
            this.style.transform = 'scale(0.97)';
            this.style.transition = 'transform 0.1s ease';
        }, { passive: true });
        element.addEventListener('touchend', function() {
            this.style.transform = '';
        }, { passive: true });
    });
}

function resetDesktopLayout() {
    const mobileBtn = document.getElementById('openManualMobile');
    if (mobileBtn) mobileBtn.remove();
    if (DOM.openManualBtn) DOM.openManualBtn.style.display = 'flex';
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    loadDrugGrid();
    selectDrug('heparin');
    loadDrugLibrary();
    initVoiceTab();
});

function initializeApp() {
    function setVH() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    setVH();
    window.addEventListener('resize', setVH);
    if (window.loadingProgress) loadingProgress(20, 'در حال بارگذاری پایگاه داده دارویی...');
    loadSettings();
    loadTheme();
    updateStats();
    updateVolumeOptions();
    setupMobileLayout();
    initSwipe();
    setupMobileOptimizations();
    setupSimpleInputHandling();
    TextDirection.applyBidiFixes();
    setupMobileNumericKeyboard();
    initializeConverters();
    initializeTools();

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => setupMobileLayout(), 150);
    });

    if (DOM.drugCount) DOM.drugCount.textContent = Object.keys(drugDatabase).length;
    if (DOM.lastUpdate) {
        const now = new Date();
        const persianDate = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        if (DOM.lastUpdate) DOM.lastUpdate.textContent = PersianNumbers.toLatin(persianDate);
    }
    setupManualCalculation();
    setupOnboarding();
    setupOfflineIndicator();
    setupTabBarMeasurement();
    setupGCS();
    setupBurns();
    setupRASS();
    setupBraden();
    setupMorse();
    setupOxygenCalculator();
    setupYSiteChecker();
    setupVentilatorCalc();
    // VBG mode toggle
    document.querySelectorAll('#vbgModeBtns .method-btn-compact').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('#vbgModeBtns .method-btn-compact').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const isABG = this.dataset.mode === 'abg';
            const chk = document.getElementById('vbgModeABG');
            if (chk) chk.checked = isABG;
            const note = document.getElementById('vbgModeNote');
            if (note) note.innerHTML = isABG
                ? '<i class="fas fa-info-circle"></i> حالت ABG: مقادیر شریانی مستقیم تفسیر می‌شوند.'
                : '<i class="fas fa-info-circle"></i> حالت VBG: pH وریدی معمولاً ۰.۰۳–۰.۰۵ کمتر از شریانی است. pCO₂ وریدی ۶–۸ mmHg بالاتر است.';
        });
    });
    setupThemePicker();
    setupUpdateDetection();
    setupThemeModeListener();
    setupUserName();
    setTimeout(showGreetingBanner, 3200);
    setupHelpPopovers();
}

function setupMobileOptimizations() {
    if (window.innerWidth <= 768) {
        document.addEventListener('touchstart', function(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
                document.body.style.zoom = '100%';
            }
        }, { passive: true });
        const drugScroll = document.querySelector('.drug-scroll-container');
        if (drugScroll) {
            drugScroll.addEventListener('touchmove', function(e) { e.stopPropagation(); }, { passive: true });
        }
    }
}

// ============================================
// SETTINGS
// ============================================
function loadSettings() {
    const savedSettings = localStorage.getItem('appSettings');
    if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        AppState.settings = Object.assign({}, AppState.settings, parsed);
    }
    if (DOM.darkModeToggle) DOM.darkModeToggle.checked = AppState.settings.darkMode;
    if (DOM.largeFontToggle) DOM.largeFontToggle.checked = AppState.settings.largeFont;
    if (DOM.doseAlertToggle) DOM.doseAlertToggle.checked = AppState.settings.doseAlerts;
    if (DOM.compatAlertToggle) DOM.compatAlertToggle.checked = AppState.settings.compatAlerts;
    if (DOM.saveHistoryToggle) DOM.saveHistoryToggle.checked = AppState.settings.saveHistory;
    if (DOM.hapticToggle) DOM.hapticToggle.checked = AppState.settings.hapticFeedback !== false;
    if (DOM.themeModeSelect) DOM.themeModeSelect.value = AppState.settings.themeMode || 'light';
    applySettings();
    syncThemeModeButtons();
}

function saveSettings() {
    localStorage.setItem('appSettings', JSON.stringify(AppState.settings));
}

function applySettings() {
    if (AppState.settings.darkMode) {
        document.body.classList.add('dark-mode');
        AppState.theme = 'dark';
        if (DOM.darkModeToggle) DOM.darkModeToggle.checked = true;
        if (DOM.themeToggle) {
            const icon = DOM.themeToggle.querySelector('i');
            if (icon) icon.className = 'fas fa-sun';
        }
    } else {
        document.body.classList.remove('dark-mode');
        AppState.theme = 'light';
        if (DOM.darkModeToggle) DOM.darkModeToggle.checked = false;
        if (DOM.themeToggle) {
            const icon = DOM.themeToggle.querySelector('i');
            if (icon) icon.className = 'fas fa-moon';
        }
    }
    if (AppState.settings.largeFont) document.body.classList.add('large-font');
    else document.body.classList.remove('large-font');
    const savedColor = AppState.settings.colorTheme || 'default';
    applyTheme(savedColor);
    fixVolumeButtonColors();
}

// ============================================
// DRUG MANAGEMENT
// ============================================
function loadDrugGrid() {
    const container = DOM.drugGrid;
    if (!container) return;
    container.innerHTML = '';
    Object.entries(drugDatabase).forEach(([id, drug]) => {
        const card = document.createElement('div');
        card.className = 'drug-item-compact';
        card.dataset.drugId = id;
        card.innerHTML = `
            <div class="drug-icon-small">${renderDrugIcon(drug.icon)}</div>
            <div class="drug-name-compact">${drug.persianName}</div>
            <div class="drug-name-english">${drug.englishName}</div>
        `;
        card.addEventListener('click', () => selectDrug(id));
        container.appendChild(card);
    });
    setupMobileLayout();
}

function selectDrug(drugId) {
    if (!drugDatabase[drugId]) return;
    const drug = drugDatabase[drugId];
    AppState.selectedDrug = drugId;
    AppState.ampouleCount = drug.defaultAmpoules;
    AppState.currentAmpouleIndex = 0;

    // Close manual calculator if open
    const manualSection = document.getElementById('manualSection');
    const calculatorControls = document.getElementById('calculatorControls');
    if (manualSection && manualSection.style.display !== 'none') {
        manualSection.style.display = 'none';
        if (calculatorControls) calculatorControls.style.display = 'grid';
        if (DOM.calculateBtnWrap) DOM.calculateBtnWrap.style.display = 'block';
        const selectedDrugHeader = document.querySelector('.selected-drug-compact');
        if (selectedDrugHeader) selectedDrugHeader.style.display = 'flex';
        const drugSidebar = document.querySelector('.drug-sidebar');
        if (drugSidebar && window.innerWidth < 768) drugSidebar.removeAttribute('style');
    }

    if (DOM.selectedDrugName) DOM.selectedDrugName.textContent = drug.persianName;
    if (DOM.selectedDrugDesc) DOM.selectedDrugDesc.innerHTML = `
        <span class="persian-inline">${drug.persianName}</span>
        <span> - </span>
        <span class="latin-inline">${drug.englishName}</span>
        <span> (</span><span class="latin-inline">${drug.category}</span><span>)</span>
    `;
    if (DOM.selectedDrugIcon) DOM.selectedDrugIcon.innerHTML = renderDrugIcon(drug.icon, 'font-size:1.5rem;');
    if (DOM.selectedDrugIcon) DOM.selectedDrugIcon.style.background = `linear-gradient(135deg, ${drug.color}, ${drug.color}99)`;

    updateAmpouleTypeSelector(drug);
    updateAmpouleInfo();
    updateVolumeOptions();
    setupCustomAmountUI(drug);

    if (DOM.weightContainer && DOM.weightCheckbox && DOM.patientWeight) {
        if (drug.weightBased && drug.weightBased.active) {
            DOM.weightContainer.style.display = 'block';
            if (DOM.weightIosToggle) DOM.weightIosToggle.classList.remove('on');
            if (DOM.weightInputRow) DOM.weightInputRow.style.display = 'none';
            const defaultUseWeight = drug.weightBased.defaultUseWeight !== undefined ? drug.weightBased.defaultUseWeight : false;
            AppState.useWeight = defaultUseWeight;
            DOM.weightCheckbox.checked = defaultUseWeight;
            DOM.patientWeight.disabled = !defaultUseWeight;
            DOM.patientWeight.value = drug.weightBased.defaultWeight || '70';
            DOM.patientWeight.setAttribute('inputmode', 'decimal');
            DOM.patientWeight.style.textAlign = 'center';
            updateWeightBasedUnit(drug);
        } else {
            DOM.weightContainer.style.display = 'none';
            AppState.useWeight = false;
            DOM.weightCheckbox.checked = false;
            DOM.patientWeight.disabled = true;
            DOM.patientWeight.value = '';
            const unitElement = document.getElementById('orderUnit');
            if (unitElement) unitElement.textContent = drug.standardUnit;
        }
    }

    if (DOM.doctorOrder) {
        DOM.doctorOrder.setAttribute('inputmode', 'decimal');
        DOM.doctorOrder.style.textAlign = 'center';
        DOM.doctorOrder.value = '';
    }

    document.querySelectorAll('.drug-item-compact').forEach(card => card.classList.remove('selected'));
    const selectedCard = document.querySelector(`.drug-item-compact[data-drug-id="${drugId}"]`);
    if (selectedCard) selectedCard.classList.add('selected');

    clearResults();
    if (DOM.customVolumeContainer) {
        DOM.customVolumeContainer.style.display = 'none';
        DOM.customVolume.value = '';
    }
    AppState.customVolume = false;
}

function updateAmpouleTypeSelector(drug) {
    const container = document.getElementById('ampouleTypeButtons');
    if (!container) return;
    container.innerHTML = '';
    if (drug.ampouleOptions.length <= 1) {
        container.style.display = 'none';
        AppState.currentAmpouleIndex = 0;
        updateAmpouleInfo();
        return;
    }
    container.style.display = 'flex';
    drug.ampouleOptions.forEach((ampoule, index) => {
        const button = document.createElement('button');
        button.className = 'ampoule-type-btn';
        button.textContent = ampoule.label;
        button.dataset.index = index;
        if (index === AppState.currentAmpouleIndex) button.classList.add('active');
        button.addEventListener('click', () => {
            container.querySelectorAll('.ampoule-type-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            AppState.currentAmpouleIndex = index;
            updateAmpouleInfo();
            clearResults();
        });
        container.appendChild(button);
    });
}

function updateAmpouleInfo() {
    const drug = drugDatabase[AppState.selectedDrug];
    const ampoule = drug.ampouleOptions[AppState.currentAmpouleIndex];
    if (DOM.ampouleCount) DOM.ampouleCount.textContent = AppState.ampouleCount;
    if (DOM.ampouleInfo) {
        const labelParts = ampoule.label.split(' in ');
        if (labelParts.length === 2) {
            DOM.ampouleInfo.innerHTML = `<span>هر آمپول: </span><span class="latin-inline">${labelParts[0]}</span><span> در </span><span class="latin-inline">${labelParts[1]}</span>`;
        } else {
            DOM.ampouleInfo.innerHTML = `<span>هر آمپول: </span><span class="latin-inline">${ampoule.label}</span>`;
        }
    }
}

function setupCustomAmountUI(drug) {
    const isInsulin = drug.id === 'insulin';
    const ampoule = drug.ampouleOptions[AppState.currentAmpouleIndex] || drug.ampouleOptions[0];
    const unit = ampoule.unit;

    AppState.useCustomDrugAmount = isInsulin;
    AppState.customDrugAmount = null;

    if (DOM.customAmountUnit) DOM.customAmountUnit.textContent = unit;
    if (DOM.customAmountInput) {
        DOM.customAmountInput.value = '';
        DOM.customAmountInput.placeholder = isInsulin ? 'واحد اضافه‌شده...' : `مقدار به ${unit}...`;
    }

    // Build preset chips
    if (DOM.customAmountPresets) {
        DOM.customAmountPresets.innerHTML = '';
        const presets = getAmountPresets(drug, unit);
        presets.forEach(val => {
            const chip = document.createElement('button');
            chip.className = 'amount-preset-chip';
            chip.textContent = val + ' ' + unit;
            chip.addEventListener('click', () => {
                if (DOM.customAmountInput) {
                    DOM.customAmountInput.value = val;
                    DOM.customAmountInput.dataset.numericValue = val;
                }
                DOM.customAmountPresets.querySelectorAll('.amount-preset-chip')
                    .forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                clearResults();
            });
            DOM.customAmountPresets.appendChild(chip);
        });
        DOM.customAmountPresets.style.display = presets.length ? 'flex' : 'none';
    }

    function setCustomOn(on) {
        AppState.useCustomDrugAmount = on;
        AppState.customDrugAmount = null;
        if (DOM.customAmountToggle) DOM.customAmountToggle.checked = on;
        if (DOM.customAmountIosToggle) DOM.customAmountIosToggle.classList.toggle('on', on);
        if (DOM.customAmountInputRow) DOM.customAmountInputRow.style.display = on ? 'block' : 'none';
        if (!isInsulin) {
            if (DOM.ampouleCounterRow) DOM.ampouleCounterRow.classList.toggle('ampoule-greyed', on);
            if (DOM.ampouleInfo) DOM.ampouleInfo.classList.toggle('ampoule-greyed', on);
        }
        if (!on && DOM.customAmountInput) DOM.customAmountInput.value = '';
        if (!on && DOM.customAmountPresets) {
            DOM.customAmountPresets.querySelectorAll('.amount-preset-chip')
                .forEach(c => c.classList.remove('active'));
        }
        clearResults();
    }

    if (isInsulin) {
        // Insulin: hide toggle row, always show input row independently
        if (DOM.customAmountToggleRow) DOM.customAmountToggleRow.style.display = 'none';
        if (DOM.ampouleCounterRow) DOM.ampouleCounterRow.style.display = 'none';
        if (DOM.ampouleInfo) DOM.ampouleInfo.style.display = 'none';
        if (DOM.customAmountInputRow) DOM.customAmountInputRow.style.display = 'block';
    } else {
        if (DOM.customAmountToggleRow) DOM.customAmountToggleRow.style.display = 'block';
        if (DOM.customAmountToggleLabel) DOM.customAmountToggleLabel.textContent = 'مقدار دلخواه دارو';
        if (DOM.ampouleCounterRow) { DOM.ampouleCounterRow.style.display = 'block'; DOM.ampouleCounterRow.classList.remove('ampoule-greyed'); }
        if (DOM.ampouleInfo) { DOM.ampouleInfo.style.display = ''; DOM.ampouleInfo.classList.remove('ampoule-greyed'); }
        if (DOM.customAmountInputRow) DOM.customAmountInputRow.style.display = 'none';

        // Wire iOS toggle row — full row tap
        const clickRow = DOM.customAmountToggleClickRow;
        if (clickRow) {
            const newRow = clickRow.cloneNode(true);
            clickRow.parentNode.replaceChild(newRow, clickRow);
            DOM.customAmountToggleClickRow = newRow;
            DOM.customAmountIosToggle = newRow.querySelector('.ios-toggle');
            DOM.customAmountToggle = newRow.querySelector('input[type=checkbox]');
            newRow.addEventListener('click', (e) => {
                if (e.target.closest('.help-icon')) return;
                haptic(25);
                setCustomOn(!AppState.useCustomDrugAmount);
            });
        }
        setCustomOn(false);
    }
}


function getAmountPresets(drug, unit) {
    const perDrug = {
        heparin:       [10000, 25000],
        lasix:         [50, 100],
        insulin:       [20, 25, 50, 100],
        fentanyl:      [500, 1000],
        pantoprazole:  [80],
        tng:           [5, 10, 20],
        norepinephrine:[4, 5, 10],
        midazolam:     [10, 20, 25, 50],
        octreotide:    [250, 500],
        labetalol:     [50, 100, 200],
        dopamine:      [200, 400],
        amiodarone:    [150, 300],
    };
    return perDrug[drug.id] || [];
}


function getEffectiveTotalDrug() {
    // Returns the total drug amount to use in calculation
    if (AppState.useCustomDrugAmount) {
        const raw = DOM.customAmountInput ? PersianNumbers.parseNumber(DOM.customAmountInput.value) : NaN;
        if (!isNaN(raw) && raw > 0) return raw;
        return null; // signal: invalid
    }
    const drug = drugDatabase[AppState.selectedDrug];
    const ampoule = drug.ampouleOptions[AppState.currentAmpouleIndex];
    return AppState.ampouleCount * ampoule.strength;
}

function updateVolumeOptions() {
    const drug = drugDatabase[AppState.selectedDrug];
    const method = AppState.infusionMethod;
    const volumes = drug.defaultSolutionVolumes[method];
    const defaultVol = drug.defaultVolume[method];
    if (!DOM.volumeOptions) return;
    DOM.volumeOptions.innerHTML = '';
    volumes.forEach(volume => {
        const btn = document.createElement('button');
        btn.className = 'volume-preset-btn';
        btn.innerHTML = `<span class="number">${volume}</span><span class="unit-text">cc</span>`;
        btn.dataset.volume = volume;
        if (volume === defaultVol) {
            btn.classList.add('active');
            AppState.solutionVolume = volume;
        }
        btn.addEventListener('click', () => {
            document.querySelectorAll('.volume-preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.solutionVolume = volume;
            if (DOM.customVolumeContainer) { DOM.customVolumeContainer.style.display = 'none'; DOM.customVolume.value = ''; }
            AppState.customVolume = false;
            clearResults();
            fixVolumeButtonColors();
        });
        DOM.volumeOptions.appendChild(btn);
    });
    const customBtn = document.createElement('button');
    customBtn.className = 'volume-preset-btn';
    customBtn.innerHTML = '<span class="custom-text">سایر</span>';
    customBtn.addEventListener('click', () => {
        if (DOM.customVolumeContainer) {
            DOM.customVolumeContainer.style.display = 'flex';
            DOM.customVolume.focus();
            AppState.customVolume = true;
            document.querySelectorAll('.volume-preset-btn').forEach(b => b.classList.remove('active'));
            clearResults();
            fixVolumeButtonColors();
        }
    });
    DOM.volumeOptions.appendChild(customBtn);
    fixVolumeButtonColors();
}

// ============================================
// CALCULATION
// ============================================
function calculateInfusion() {
    const drug = drugDatabase[AppState.selectedDrug];
    const ampoule = drug.ampouleOptions[AppState.currentAmpouleIndex];

    let doseValue;
    if (DOM.doctorOrder.value && DOM.doctorOrder.value.trim() !== '') {
        doseValue = DOM.doctorOrder.dataset.numericValue
            ? parseFloat(DOM.doctorOrder.dataset.numericValue)
            : PersianNumbers.parseNumber(DOM.doctorOrder.value);
    }

    if (!doseValue || isNaN(doseValue) || doseValue <= 0) {
        showToast('خطا', 'لطفاً مقدار دوز درخواستی را وارد کنید', 'error');
        DOM.doctorOrder.focus();
        DOM.doctorOrder.style.borderColor = 'var(--danger)';
        return;
    }
    DOM.doctorOrder.style.borderColor = '';
    updateDoseRangeIndicator();

    let desiredDosePerHour;

    // Parse units to drive all conversion logic
    const stdUnit = drug.standardUnit || '';
    const ampouleInMg = (drug.ampouleOptions[0]?.unit || '') === 'mg';
    let doseAlreadyNormalized = false;

    if (drug.weightBased && drug.weightBased.active && AppState.useWeight) {
        let weightValue;
        if (DOM.patientWeight.value && DOM.patientWeight.value.trim() !== '') {
            weightValue = DOM.patientWeight.dataset.numericValue
                ? parseFloat(DOM.patientWeight.dataset.numericValue)
                : PersianNumbers.parseNumber(DOM.patientWeight.value);
        }
        if (!weightValue || isNaN(weightValue) || weightValue <= 0) {
            showToast('خطا', 'لطفاً وزن بیمار را وارد کنید', 'error');
            DOM.patientWeight.focus();
            DOM.patientWeight.style.borderColor = 'var(--danger)';
            return;
        }
        DOM.patientWeight.style.borderColor = '';
        AppState.patientWeight = weightValue;

        // Use weightBased.unit for the weight branch — it reflects what the user actually enters
        const wbUnit = drug.weightBased.unit || stdUnit;
        const wbPerMin = wbUnit.includes('/min');
        const wbInMcg  = wbUnit.startsWith('mcg');

        // Convert dose (wbUnit) → drug storage unit per hour
        let dosePerHour = doseValue * weightValue * (wbPerMin ? 60 : 1);
        // If wb dose is in mcg but ampoule is in mg → convert to mg/h now;
        // flag so concentration step doesn't double-convert
        if (wbInMcg && ampouleInMg) {
            dosePerHour /= 1000;
            doseAlreadyNormalized = true;
        }
        desiredDosePerHour = dosePerHour;

    } else {
        AppState.patientWeight = null;
        const isPerMin = stdUnit.includes('/min');
        // Non-weight: mg/min or mcg/min → ×60; mg/h or units/h → ×1
        desiredDosePerHour = doseValue * (isPerMin ? 60 : 1);
    }

    // doseInMcg used for concentration unit conversion below
    const doseInMcg = stdUnit.startsWith('mcg');

    if (AppState.customVolume) {
        let customVol;
        if (DOM.customVolume.value && DOM.customVolume.value.trim() !== '') {
            customVol = DOM.customVolume.dataset.numericValue
                ? parseFloat(DOM.customVolume.dataset.numericValue)
                : PersianNumbers.parseNumber(DOM.customVolume.value);
        }
        if (!customVol || isNaN(customVol) || customVol <= 0) {
            showToast('خطا', 'حجم محلول وارد شده معتبر نیست', 'error');
            DOM.customVolume.focus();
            return;
        }
        AppState.solutionVolume = customVol;
    }

    AppState.desiredDose = doseValue;

    // Custom drug amount takes priority over ampoule count × strength
    const totalDrug = getEffectiveTotalDrug();
    if (totalDrug === null) {
        showToast('خطا', `لطفاً مقدار دارو را وارد کنید`, 'error');
        if (DOM.customAmountInput) DOM.customAmountInput.focus();
        return;
    }

    const concentration = totalDrug / AppState.solutionVolume;

    let totalDrugForCalculation = totalDrug;
    let concentrationForCalculation = concentration;
    let desiredDoseForCalculation = desiredDosePerHour;

    // If dose unit is mcg but ampoule/drug is stored in mg → convert drug to mcg for concentration
    // Skip if weight branch already normalized dose to mg (prevents double-conversion)
    if (doseInMcg && ampouleInMg && !doseAlreadyNormalized) {
        totalDrugForCalculation = totalDrug * 1000;
        concentrationForCalculation = totalDrugForCalculation / AppState.solutionVolume;
    }

    const pumpRate = desiredDoseForCalculation / concentrationForCalculation;
    const duration = AppState.solutionVolume / pumpRate;

    displayResults(totalDrug, concentration, pumpRate, duration, ampoule.unit);
    displayDripRate(pumpRate, AppState.solutionVolume);
    generateStepByStepGuide(drug, totalDrug, concentration, pumpRate, doseValue);
    displayWarnings(drug);
    displayCompatibility(drug);

    if (AppState.settings.saveHistory) saveCalculation(totalDrug, concentration, pumpRate, duration);
    updateCalculationStats();
    showToast('موفق', 'محاسبه با موفقیت انجام شد', 'success');
}

function displayResults(totalDrug, concentration, pumpRate, duration, unit) {
    const drug = drugDatabase[AppState.selectedDrug];
    DOM.totalDrugAmount.textContent = PersianNumbers.formatNumber(totalDrug, 0);
    DOM.totalDrugUnit.innerHTML = `<span class="latin-inline">${unit}</span>`;

    let concentrationDisplay, concentrationUnitDisplay;
    const _doseInMcg = (drug.standardUnit || '').startsWith('mcg');
    const _ampouleInMg = (drug.ampouleOptions[0]?.unit || '') === 'mg';
    if (_doseInMcg && _ampouleInMg) {
        concentrationDisplay = PersianNumbers.formatNumber(concentration * 1000, 2);
        concentrationUnitDisplay = 'mcg/cc';
    } else {
        concentrationDisplay = PersianNumbers.formatNumber(concentration, 2);
        concentrationUnitDisplay = `${unit}/cc`;
    }
    DOM.concentrationResult.textContent = concentrationDisplay;
    DOM.concentrationUnit.innerHTML = `<span class="latin-inline">${concentrationUnitDisplay}</span>`;
    DOM.pumpRateResult.textContent = PersianNumbers.formatNumber(pumpRate, 2);
    DOM.pumpRateUnit.innerHTML = `<span class="latin-inline">cc/hour</span>`;
    DOM.durationResult.textContent = PersianNumbers.formatNumber(duration, 1);
    DOM.durationUnit.innerHTML = `<span class="persian-inline">ساعت</span>`;

    if (DOM.resultsSection) {
        DOM.resultsSection.classList.add('show');
        DOM.resultsSection.style.display = 'block';
        setTimeout(() => DOM.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
}

function clearResults() {
    if (DOM.resultsSection) { DOM.resultsSection.classList.remove('show'); DOM.resultsSection.style.display = 'none'; }
    if (DOM.guideSection) DOM.guideSection.style.display = 'none';
    if (DOM.warningsSection) DOM.warningsSection.style.display = 'none';
    if (DOM.compatibilitySection) DOM.compatibilitySection.style.display = 'none';
    if (DOM.dripRateRow) DOM.dripRateRow.style.display = 'none';
    const pumpRateCard = document.getElementById('pumpRateResult')?.closest('.result-item-enhanced');
    if (pumpRateCard) {
        pumpRateCard.classList.remove('highlight');
        const labelEl = pumpRateCard.querySelector('.result-label-enhanced');
        const valueEl = pumpRateCard.querySelector('.result-value-enhanced');
        const unitEl = pumpRateCard.querySelector('.result-unit-enhanced');
        if (labelEl) labelEl.textContent = 'سرعت پمپ';
        if (valueEl) { valueEl.textContent = '0'; valueEl.style.color = ''; }
        if (unitEl) unitEl.innerHTML = '';
    }
    const origHighlight = document.querySelector('.result-item-enhanced:nth-child(3)');
    if (origHighlight && !origHighlight.classList.contains('highlight')) origHighlight.classList.add('highlight');
}

function generateStepByStepGuide(drug, totalDrug, concentration, pumpRate, desiredDose) {
    if (!DOM.guideSection || !DOM.stepByStepGuide) return;
    DOM.stepByStepGuide.innerHTML = '';
    const { factor: dripFactor, label: dripLabel } = getDripFactor(AppState.solutionVolume);
    const dropsPerMin = (pumpRate * dripFactor) / 60;
    const setType = AppState.solutionVolume <= 100 ? 'سرنگ پمپ / میکروست' : 'ست وریدی ماکروست';
    const drugPrep = AppState.useCustomDrugAmount
        ? `اضافه کردن ${PersianNumbers.formatNumber(totalDrug, 0)} ${drug.ampouleOptions[0].unit} از ${drug.persianName} به محلول`
        : `آماده کردن ${AppState.ampouleCount} آمپول ${drug.persianName}`;
    const steps = [
        `۱. ${drugPrep}`,
        `۲. کشیدن ${AppState.solutionVolume} cc محلول ${drug.solutionType[0]} به سرنگ/کیسه`,
        `۳. اضافه کردن ${PersianNumbers.formatNumber(totalDrug, 0)} ${drug.ampouleOptions[0].unit} از دارو به محلول`,
        `۴. مخلوط کردن کامل محلول`,
        `۵. نصب بر روی پمپ ${AppState.infusionMethod === 'syringe' ? 'سرنگ' : 'انفوزیون'} با ${setType}`,
        `۶. تنظیم سرعت پمپ روی ${PersianNumbers.formatNumber(pumpRate, 2)} cc/hour`,
        `۷. در صورت تزریق گراویتی: ${PersianNumbers.formatNumber(dropsPerMin, 1)} قطره/دقیقه (${dripLabel})`,
        `۸. شروع تزریق با دوز ${PersianNumbers.formatNumber(desiredDose, 2)} ${drug.standardUnit}`
    ];
    steps.forEach(step => {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'guide-step';
        stepDiv.innerHTML = `<div class="step-content">${step}</div>`;
        DOM.stepByStepGuide.appendChild(stepDiv);
    });
    DOM.guideSection.style.display = 'block';
}

function displayWarnings(drug) {
    if (!DOM.warningsSection || !DOM.warningsList) return;
    const cautions = drug?.cautions;
    if (!cautions || !Array.isArray(cautions) || cautions.length === 0) {
        DOM.warningsSection.style.display = 'none';
        return;
    }
    DOM.warningsList.innerHTML = '';
    cautions.forEach(caution => {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'warning-item';
        warningDiv.innerHTML = `<i class="fas fa-exclamation-circle warning-icon"></i><span class="warning-text">${caution}</span>`;
        DOM.warningsList.appendChild(warningDiv);
    });
    DOM.warningsSection.style.display = 'block';
}

function displayCompatibility(drug) {
    if (!DOM.compatibilitySection || !DOM.compatibleDrugsList || !DOM.incompatibleDrugsList) return;
    DOM.compatibleDrugsList.innerHTML = '';
    DOM.incompatibleDrugsList.innerHTML = '';
    if (drug.ySiteCompatibilities) {
        drug.ySiteCompatibilities.compatible.forEach(drugName => {
            const item = document.createElement('div');
            item.textContent = drugName;
            item.className = 'persian-text';
            DOM.compatibleDrugsList.appendChild(item);
        });
        drug.ySiteCompatibilities.incompatible.forEach(drugName => {
            const item = document.createElement('div');
            item.textContent = drugName;
            item.className = 'persian-text';
            DOM.incompatibleDrugsList.appendChild(item);
        });
    }
    DOM.compatibilitySection.style.display = 'block';
}

function updateWeightBasedUnit(drug) {
    const unitElement = document.getElementById('orderUnit');
    if (!unitElement || !drug.weightBased) return;
    unitElement.textContent = AppState.useWeight ? drug.weightBased.unit : (drug.weightBased.nonWeightUnit || drug.standardUnit);
    clearResults();
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    function animateBtn(btn) {
        if (!btn) return;
        btn.classList.add('btn-press');
        btn.classList.add('btn-spin');
        setTimeout(() => btn.classList.remove('btn-press'), 150);
        setTimeout(() => btn.classList.remove('btn-spin'), 500);
    }

    ['themeToggle', 'historyBtn', 'settingsBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('touchstart', () => animateBtn(btn), { passive: true });
        btn.addEventListener('mousedown', () => animateBtn(btn));
    });

    if (DOM.themeToggle) DOM.themeToggle.addEventListener('click', () => { haptic(25); toggleTheme(); });
    if (DOM.historyBtn) DOM.historyBtn.addEventListener('click', () => {
        loadHistory();
        if (DOM.historyModal) { DOM.historyModal.classList.add('active'); document.body.classList.add('no-scroll'); }
    });
    if (DOM.settingsBtn) DOM.settingsBtn.addEventListener('click', () => {
        if (DOM.settingsModal) { DOM.settingsModal.classList.add('active'); document.body.classList.add('no-scroll'); }
    });
    if (DOM.tabItems) DOM.tabItems.forEach(btn => btn.addEventListener('click', function() { switchTab(this.dataset.tab); }));
    if (DOM.methodBtns) DOM.methodBtns.forEach(btn => btn.addEventListener('click', function() {
        DOM.methodBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        AppState.infusionMethod = this.dataset.method;
        fixMethodButtonTextColor();
        updateVolumeOptions();
        clearResults();
    }));
    if (DOM.decreaseAmpoule) DOM.decreaseAmpoule.addEventListener('click', () => {
        if (AppState.ampouleCount > 1) { AppState.ampouleCount--; updateAmpouleInfo(); clearResults(); }
    });
    if (DOM.increaseAmpoule) DOM.increaseAmpoule.addEventListener('click', () => {
        const drug = drugDatabase[AppState.selectedDrug];
        const maxAmpoules = Math.floor(1000 / drug.ampouleOptions[0].strength) || 20;
        if (AppState.ampouleCount < maxAmpoules) { AppState.ampouleCount++; updateAmpouleInfo(); clearResults(); }
    });
    
    // Weight toggle row click handling (whole row)
    const weightToggleRow = document.getElementById('weightToggleRow');
    if (weightToggleRow) {
        weightToggleRow.addEventListener('click', (e) => {
            if (e.target.closest('.help-icon')) return; // let help popover handle it
            // Prevent toggling twice if the click came from the toggle itself
            if (e.target.closest('.ios-toggle')) return;
            haptic(25);
            AppState.useWeight = !AppState.useWeight;
            if (DOM.weightCheckbox) DOM.weightCheckbox.checked = AppState.useWeight;
            if (DOM.weightIosToggle) DOM.weightIosToggle.classList.toggle('on', AppState.useWeight);
            if (DOM.weightInputRow) {
                DOM.weightInputRow.style.display = AppState.useWeight ? 'flex' : 'none';
            }
            if (DOM.patientWeight) {
                DOM.patientWeight.disabled = !AppState.useWeight;
                if (AppState.useWeight) setTimeout(() => DOM.patientWeight.focus(), 150);
            }
            const drug = drugDatabase[AppState.selectedDrug];
            updateWeightBasedUnit(drug);
            clearResults();
        });
    }
    
    // Also keep individual toggle click (to update the row state without double toggling)
    if (DOM.weightIosToggle) {
        DOM.weightIosToggle.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent row handler from firing again
            haptic(25);
            AppState.useWeight = !AppState.useWeight;
            if (DOM.weightCheckbox) DOM.weightCheckbox.checked = AppState.useWeight;
            DOM.weightIosToggle.classList.toggle('on', AppState.useWeight);
            if (DOM.weightInputRow) {
                DOM.weightInputRow.style.display = AppState.useWeight ? 'flex' : 'none';
            }
            if (DOM.patientWeight) {
                DOM.patientWeight.disabled = !AppState.useWeight;
                if (AppState.useWeight) setTimeout(() => DOM.patientWeight.focus(), 150);
            }
            const drug = drugDatabase[AppState.selectedDrug];
            updateWeightBasedUnit(drug);
            clearResults();
        });
    }

    if (DOM.weightCheckbox && DOM.patientWeight) {
        DOM.weightCheckbox.addEventListener('change', function() {
            AppState.useWeight = this.checked;
            DOM.patientWeight.disabled = !this.checked;
            if (DOM.weightIosToggle) DOM.weightIosToggle.classList.toggle('on', this.checked);
            if (DOM.weightInputRow) DOM.weightInputRow.style.display = this.checked ? 'flex' : 'none';
            const drug = drugDatabase[AppState.selectedDrug];
            updateWeightBasedUnit(drug);
            if (this.checked && DOM.patientWeight) DOM.patientWeight.focus();
            clearResults();
        });
    }
    if (DOM.customVolume) {
        DOM.customVolume.setAttribute('inputmode', 'numeric');
        DOM.customVolume.setAttribute('pattern', '[0-9]*');
        DOM.customVolume.style.textAlign = 'center';
    }
    if (DOM.calculateBtn) DOM.calculateBtn.addEventListener('click', () => {
        haptic(40);
        if (AppState.reverseMode) calculateReverse();
        else calculateInfusion();
    });

    const copyResultBtn = document.getElementById('copyResultBtn');
    if (copyResultBtn) copyResultBtn.addEventListener('click', () => {
        const drug = drugDatabase[AppState.selectedDrug];
        const pumpRate = document.getElementById('pumpRateResult')?.textContent;
        const concentration = document.getElementById('concentrationResult')?.textContent;
        const concentrationUnit = document.getElementById('concentrationUnit')?.textContent;
        const dose = AppState.desiredDose;
        const unit = drug?.standardUnit || '';
        const text = `MedCalc Pro\n${drug?.persianName || ''} (${drug?.englishName || ''})\nدوز: ${dose} ${unit}\nغلظت: ${concentration} ${concentrationUnit}\nسرعت پمپ: ${pumpRate} cc/hr`;
        if (navigator.share) {
            navigator.share({ title: 'FoxiMed', text }).catch(() => {});
            haptic(30);
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => { showToast('کپی شد', 'نتیجه در کلیپ‌بورد کپی شد', 'success'); haptic(20); });
        } else {
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
            showToast('کپی شد', 'نتیجه در کلیپ‌بورد کپی شد', 'success');
        }
    });

    if (DOM.doctorOrder) {
        DOM.doctorOrder.addEventListener('input', () => clearResults());
        DOM.doctorOrder.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); calculateInfusion(); } });
    }
    if (DOM.closeSettings) DOM.closeSettings.addEventListener('click', () => {
        if (DOM.settingsModal) { DOM.settingsModal.classList.remove('active'); document.body.classList.remove('no-scroll'); }
    });
    if (DOM.closeHistory) DOM.closeHistory.addEventListener('click', () => {
        if (DOM.historyModal) { DOM.historyModal.classList.remove('active'); document.body.classList.remove('no-scroll'); }
    });
    if (DOM.drugSearch) DOM.drugSearch.addEventListener('input', function() {
        const term = this.value.toLowerCase();
        document.querySelectorAll('.drug-item-compact').forEach(card => {
            const drugId = card.dataset.drugId;
            const drug = drugDatabase[drugId];
            if (!drug) return;
            const searchText = [drug.persianName, drug.englishName, drug.category, ...(drug.alternativeNames || [])].join(' ').toLowerCase();
            card.style.display = searchText.includes(term) ? 'flex' : 'none';
        });
    });
    if (DOM.librarySearch) DOM.librarySearch.addEventListener('input', function() {
        const term = this.value.toLowerCase();
        document.querySelectorAll('.qref-accordion-item').forEach(card => {
            const drugName = card.querySelector('.qref-name')?.textContent || '';
            const englishName = card.querySelector('.qref-english')?.textContent || '';
            card.style.display = (drugName + ' ' + englishName).toLowerCase().includes(term) ? 'block' : 'none';
        });
    });
    // Reverse mode toggle row
    const reverseRow = document.querySelector('.reverse-toggle-row');
    if (reverseRow) {
        reverseRow.addEventListener('click', (e) => {
            if (e.target.closest('.help-icon')) return;
            haptic(30);
            AppState.reverseMode = !AppState.reverseMode;
            if (AppState.reverseMode && !localStorage.getItem('reverseTooltipSeen')) {
                showReverseTooltip();
            }
            updateReverseUI();
            clearResults();
        });
    }

    if (DOM.doctorOrder) {
        DOM.doctorOrder.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); DOM.calculateBtn?.click(); }
        });
        DOM.doctorOrder.addEventListener('input', () => {
            clearResults();
            updateDoseRangeIndicator();
        });
    }

    setupSettingsEventListeners();
    window.addEventListener('resize', () => setupMobileLayout());
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
}
// ============================================
// SETTINGS EVENT LISTENERS
// ============================================
function setupSettingsEventListeners() {
    // Dark mode toggle (from settings modal)
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', function() {
            AppState.settings.darkMode = this.checked;
            AppState.settings.themeMode = this.checked ? 'dark' : 'light';
            if (DOM.themeModeSelect) DOM.themeModeSelect.value = AppState.settings.themeMode;
            saveSettings();
            applySettings();
        });
    }

    // Large font toggle
    const largeFontToggle = document.getElementById('largeFontToggle');
    if (largeFontToggle) {
        largeFontToggle.addEventListener('change', function() {
            AppState.settings.largeFont = this.checked;
            saveSettings();
            applySettings();
        });
    }

    // Dose alerts
    const doseAlertToggle = document.getElementById('doseAlertToggle');
    if (doseAlertToggle) {
        doseAlertToggle.addEventListener('change', function() {
            AppState.settings.doseAlerts = this.checked;
            saveSettings();
        });
    }

    // Compatibility alerts
    const compatAlertToggle = document.getElementById('compatAlertToggle');
    if (compatAlertToggle) {
        compatAlertToggle.addEventListener('change', function() {
            AppState.settings.compatAlerts = this.checked;
            saveSettings();
        });
    }

    // Save history
    const saveHistoryToggle = document.getElementById('saveHistoryToggle');
    if (saveHistoryToggle) {
        saveHistoryToggle.addEventListener('change', function() {
            AppState.settings.saveHistory = this.checked;
            saveSettings();
        });
    }

    // Clear calculation history (settings modal)
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', function() {
            if (confirm('آیا از پاک کردن تاریخچه اطمینان دارید؟')) {
                localStorage.removeItem('calculationHistory');
                showToast('تاریخچه پاک شد', 'تمامی محاسبات ذخیره شده حذف شدند.', 'success');
            }
        });
    }

    // Haptic feedback
    const hapticToggle = document.getElementById('hapticToggle');
    if (hapticToggle) {
        hapticToggle.addEventListener('change', function() {
            AppState.settings.hapticFeedback = this.checked;
            saveSettings();
            if (this.checked) haptic(40);
        });
    }

    // Export data
    const exportDataBtn = document.getElementById('exportDataBtn');
    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', exportHistory);
    }

    // Theme mode dropdown (if still present – fallback)
    const themeModeSelect = document.getElementById('themeModeSelect');
    if (themeModeSelect) {
        themeModeSelect.addEventListener('change', function() {
            AppState.settings.themeMode = this.value;
            saveSettings();
            applyThemeMode();
            if (DOM.darkModeToggle) DOM.darkModeToggle.checked = AppState.settings.darkMode;
        });
    }

    // Theme mode 3-button row
    const themeBtns = document.querySelectorAll('#themeModeButtons .theme-mode-btn');
    themeBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            AppState.settings.themeMode = this.dataset.mode;
            saveSettings();
            applyThemeMode();
            syncThemeModeButtons();
        });
    });

    // Check for updates
    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', async function() {
            this.disabled = true;
            const origHTML = this.innerHTML;
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> در حال بررسی...';
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) {
                    await reg.update();
                    if (reg.waiting) {
                        showUpdateBanner();
                    } else {
                        showToast('بروز است', 'شما آخرین نسخه FoxiMed را دارید', 'success');
                    }
                }
            } catch(e) {
                showToast('خطا', 'بررسی به‌روزرسانی ممکن نشد', 'error');
            }
            setTimeout(() => { this.disabled = false; this.innerHTML = origHTML; }, 1500);
        });
    }
}

// ============================================
// VOICE ASSISTANT
// Moved out to voice-recognition.js / voice-commands.js / voice-ui.js
// for maintainability. Loaded after this file; initVoiceTab() below
// resolves to voice-ui.js's window.initVoiceTab at call time.
// ============================================

// ============================================
// MANUAL CALCULATION
// ============================================
function setupManualCalculation() {
    if (DOM.openManualBtn && DOM.manualSection && DOM.calculatorControls) {
        DOM.openManualBtn.addEventListener('click', openManualCalculation);
    }
}

function openManualCalculation() {
    const manualSection = DOM.manualSection;
    const calculatorControls = DOM.calculatorControls;
    const selectedDrugHeader = document.querySelector('.selected-drug-compact');
    const drugSidebar = document.querySelector('.drug-sidebar');
    const calcBtnWrap = DOM.calculateBtnWrap;

    if (manualSection && calculatorControls) {
        if (calculatorControls) calculatorControls.style.display = 'none';
        if (calcBtnWrap) calcBtnWrap.style.display = 'none';
        if (selectedDrugHeader) selectedDrugHeader.style.display = 'none';
        manualSection.style.display = 'flex';
        manualSection.style.flexDirection = 'column';
        manualSection.style.height = '100%';
        if (!manualSection.querySelector('.manual-controls')) createManualCalculationContent();
        ['resultsSection', 'guideSection', 'warningsSection', 'compatibilitySection'].forEach(id => {
            const section = document.getElementById(id);
            if (section) section.style.display = 'none';
        });
        if (drugSidebar && window.innerWidth < 768) drugSidebar.style.display = 'none';
    }
}

function createManualCalculationContent() {
    const manualSection = document.getElementById('manualSection');
    if (!manualSection) return;
    manualSection.innerHTML = `
        <div class="manual-header">
            <h3><i class="fas fa-calculator"></i> محاسبه دستی دارو</h3>
            <button class="icon-btn" id="closeManualBtn"><i class="fas fa-times"></i></button>
        </div>
        <div class="manual-controls">

            <!-- Step 1: Method -->
            <div class="control-group">
                <label><i class="fas fa-infinity"></i> روش تزریق</label>
                <div class="method-selector-compact">
                    <button class="method-btn-compact gradient active" data-method="syringe"><i class="fas fa-syringe"></i> <span>پمپ سرنگ</span></button>
                    <button class="method-btn-compact gradient" data-method="infusion"><i class="fas fa-pump-medical"></i> <span>پمپ انفوزیون</span></button>
                </div>
            </div>

            <!-- Step 2: Solution volume -->
            <div class="control-group">
                <label><i class="fas fa-flask"></i> حجم محلول (سی‌سی)</label>
                <div class="manual-volume-presets" id="manualVolumePresets">
                    <button class="volume-preset-btn" data-vol="10"><span class="number">10</span><span class="unit-text">cc</span></button>
                    <button class="volume-preset-btn" data-vol="20"><span class="number">20</span><span class="unit-text">cc</span></button>
                    <button class="volume-preset-btn active" data-vol="50"><span class="number">50</span><span class="unit-text">cc</span></button>
                    <button class="volume-preset-btn" data-vol="100" style="display:none;"><span class="number">100</span><span class="unit-text">cc</span></button>
                    <button class="volume-preset-btn" data-vol="250" style="display:none;"><span class="number">250</span><span class="unit-text">cc</span></button>
                    <button class="volume-preset-btn" data-vol="500" style="display:none;"><span class="number">500</span><span class="unit-text">cc</span></button>
                    <button class="volume-preset-btn" data-vol="custom"><span class="custom-text">سایر</span></button>
                </div>
                <div class="volume-custom-input" id="manualCustomVolumeRow" style="display:none;">
                    <input type="number" id="manualCustomVolume" placeholder="حجم دلخواه" min="1" inputmode="numeric">
                    <span>سی‌سی</span>
                </div>
            </div>

            <!-- Step 3: Drug amount -->
            <div class="control-group">
                <label><i class="fas fa-vial"></i> مقدار دارو اضافه‌شده به محلول</label>
                <div class="manual-drug-amount-row">
                    <input type="number" id="manualDrugAmount" placeholder="مقدار" step="any" min="0" inputmode="decimal" class="manual-amount-input">
                    <select id="manualDrugUnit" class="manual-unit-select">
                        <option value="units">واحد (units)</option>
                        <option value="mg" selected>میلی‌گرم (mg)</option>
                        <option value="mcg">میکروگرم (mcg)</option>
                        <option value="g">گرم (g)</option>
                    </select>
                </div>
            </div>

            <!-- Step 4: Desired dose -->
            <div class="control-group">
                <label><i class="fas fa-file-medical-alt"></i> دوز درخواستی</label>
                <div class="manual-drug-amount-row">
                    <input type="number" id="manualDesiredDose" placeholder="دوز" step="any" min="0" inputmode="decimal" class="manual-amount-input">
                    <select id="manualDoseUnit" class="manual-unit-select">
                        <option value="units/hr">units/hr</option>
                        <option value="mg/hr">mg/hr</option>
                        <option value="mcg/hr">mcg/hr</option>
                        <option value="mg/min">mg/min</option>
                        <option value="mcg/min">mcg/min</option>
                        <option value="mcg/kg/min">mcg/kg/min</option>
                        <option value="units/kg/hr">units/kg/hr</option>
                    </select>
                </div>
            </div>

            <!-- Weight (shown when dose unit contains /kg) -->
            <div class="calc-toggle-item" id="manualWeightRow" style="display:none;">
                <div class="weight-input-row" style="display:flex;">
                    <i class="fas fa-user"></i>
                    <input type="number" id="manualPatientWeight" placeholder="وزن بیمار" min="1" step="0.1" inputmode="decimal">
                    <span class="weight-unit latin-inline">kg</span>
                </div>
            </div>

            <button class="calculate-btn-enhanced gradient" id="manualCalculateBtn">
                <i class="fas fa-calculator"></i><span>محاسبه</span>
            </button>

            <div class="manual-results" id="manualResults" style="display:none; margin-top:16px;">
                <div class="results-grid-enhanced" style="grid-template-columns: repeat(2, 1fr);">
                    <div class="result-item-enhanced">
                        <div class="result-label-enhanced">غلظت محلول</div>
                        <div class="result-value-enhanced" id="manualConcentration">0</div>
                        <div class="result-unit-enhanced" id="manualConcentrationUnit"></div>
                    </div>
                    <div class="result-item-enhanced">
                        <div class="result-label-enhanced">مقدار کل دارو</div>
                        <div class="result-value-enhanced" id="manualTotalDrug">0</div>
                        <div class="result-unit-enhanced" id="manualTotalDrugUnit"></div>
                    </div>
                    <div class="result-item-enhanced highlight gradient" style="grid-column: span 2;">
                        <div class="result-label-enhanced">سرعت پمپ</div>
                        <div class="result-value-enhanced" id="manualPumpRate">0</div>
                        <div class="result-unit-enhanced">cc/hour</div>
                    </div>
                </div>
                <div class="drip-rate-row" id="manualDripRow" style="margin-top:10px;">
                    <div class="drip-rate-icon"><i class="fas fa-droplet"></i></div>
                    <div class="drip-rate-body">
                        <span class="drip-rate-label" id="manualDripLabel">سرعت قطره</span>
                        <span class="drip-rate-value"><span id="manualDripRate">0</span> <span class="drip-rate-unit">قطره/دقیقه</span></span>
                    </div>
                </div>
                <div class="manual-duration-row" id="manualDurationRow">
                    <i class="fas fa-clock" style="color:var(--primary);"></i>
                    <span>زمان تخمینی تزریق: </span>
                    <strong id="manualDuration">0 ساعت</strong>
                </div>
            </div>
        </div>
    `;
    setupManualCalculationFunctionality();
}


function setupManualCalculationFunctionality() {
    // Method toggle
    const methodBtns = document.querySelectorAll('#manualSection .method-btn-compact');
    methodBtns.forEach(btn => btn.addEventListener('click', function() {
        methodBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        // Adjust volume presets based on method
        const isSyringe = this.dataset.method === 'syringe';
        const syringeVols = [10, 20, 50];
        const infusionVols = [100, 250, 500];
        document.querySelectorAll('#manualVolumePresets .volume-preset-btn').forEach(b => {
            if (!b.dataset.vol || b.dataset.vol === 'custom') return;
            const vol = parseInt(b.dataset.vol);
            b.style.display = (isSyringe ? syringeVols : infusionVols).includes(vol) ? '' : 'none';
        });
        // Reset active to first visible
        let firstVisible = null;
        document.querySelectorAll('#manualVolumePresets .volume-preset-btn').forEach(b => {
            b.classList.remove('active');
            if (!firstVisible && b.style.display !== 'none' && b.dataset.vol !== 'custom') firstVisible = b;
        });
        if (firstVisible) firstVisible.classList.add('active');
        fixVolumeButtonColors();
    }));

    // Volume presets
    let manualVolume = 50;
    const volBtns = document.querySelectorAll('#manualVolumePresets .volume-preset-btn');
    const manualCustomVolumeRow = document.getElementById('manualCustomVolumeRow');
    volBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            volBtns.forEach(b => b.classList.remove('active'));
            if (this.dataset.vol === 'custom') {
                if (manualCustomVolumeRow) manualCustomVolumeRow.style.display = 'flex';
                this.classList.add('active');
            } else {
                if (manualCustomVolumeRow) manualCustomVolumeRow.style.display = 'none';
                manualVolume = parseInt(this.dataset.vol);
                this.classList.add('active');
            }
            fixVolumeButtonColors();
        });
    });

    // Show weight input when dose unit contains /kg
    const doseUnitSelect = document.getElementById('manualDoseUnit');
    const manualWeightRow = document.getElementById('manualWeightRow');
    if (doseUnitSelect) {
        doseUnitSelect.addEventListener('change', function() {
            if (manualWeightRow) manualWeightRow.style.display = this.value.includes('/kg') ? 'block' : 'none';
        });
    }

    // Calculate
    document.getElementById('manualCalculateBtn').addEventListener('click', calculateManualInfusion);

    // Close
    document.getElementById('closeManualBtn').addEventListener('click', () => {
        document.getElementById('manualSection').style.display = 'none';
        document.getElementById('calculatorControls').style.display = 'grid';
        if (DOM.calculateBtnWrap) DOM.calculateBtnWrap.style.display = 'block';
        const selectedDrugHeader = document.querySelector('.selected-drug-compact');
        if (selectedDrugHeader) selectedDrugHeader.style.display = 'flex';
        const drugSidebar = document.querySelector('.drug-sidebar');
        if (drugSidebar && window.innerWidth < 768) drugSidebar.removeAttribute('style');
    });
}

function calculateManualInfusion() {
    // Get volume
    let solutionVolume;
    const activeVolBtn = document.querySelector('#manualVolumePresets .volume-preset-btn.active');
    if (activeVolBtn?.dataset.vol === 'custom') {
        solutionVolume = PersianNumbers.parseNumber(document.getElementById('manualCustomVolume')?.value);
    } else {
        solutionVolume = activeVolBtn ? parseInt(activeVolBtn.dataset.vol) : NaN;
    }

    const drugAmount = PersianNumbers.parseNumber(document.getElementById('manualDrugAmount')?.value);
    const drugUnit = document.getElementById('manualDrugUnit')?.value || 'mg';
    const desiredDose = PersianNumbers.parseNumber(document.getElementById('manualDesiredDose')?.value);
    const doseUnit = document.getElementById('manualDoseUnit')?.value || 'mg/hr';
    const patientWeight = PersianNumbers.parseNumber(document.getElementById('manualPatientWeight')?.value) || 0;

    // Validate
    if (!solutionVolume || isNaN(solutionVolume) || solutionVolume <= 0) {
        showToast('خطا', 'حجم محلول را انتخاب کنید', 'error'); return;
    }
    if (!drugAmount || isNaN(drugAmount) || drugAmount <= 0) {
        showToast('خطا', 'مقدار دارو را وارد کنید', 'error');
        document.getElementById('manualDrugAmount')?.focus(); return;
    }
    if (!desiredDose || isNaN(desiredDose) || desiredDose <= 0) {
        showToast('خطا', 'دوز درخواستی را وارد کنید', 'error');
        document.getElementById('manualDesiredDose')?.focus(); return;
    }
    if (doseUnit.includes('/kg') && (!patientWeight || patientWeight <= 0)) {
        showToast('خطا', 'وزن بیمار را وارد کنید', 'error');
        document.getElementById('manualPatientWeight')?.focus(); return;
    }

    // Normalize drug amount to the dose unit's base unit
    let drugAmountNorm = drugAmount;
    if (drugUnit === 'g' && (doseUnit.includes('mg') || doseUnit.includes('mcg'))) drugAmountNorm *= 1000;
    if (drugUnit === 'mg' && doseUnit.includes('mcg')) drugAmountNorm *= 1000;
    if (drugUnit === 'mcg' && doseUnit.includes('mg')) drugAmountNorm /= 1000;

    const concentration = drugAmountNorm / solutionVolume; // per cc

    // Convert desired dose to per-hour
    let dosePerHour = desiredDose;
    if (doseUnit.includes('/min')) dosePerHour = desiredDose * 60;
    if (doseUnit.includes('/kg')) {
        dosePerHour = dosePerHour * patientWeight;
    }

    const pumpRate = dosePerHour / concentration;
    const duration = solutionVolume / pumpRate;
    const { factor: dripFactor, label: dripLabel } = getDripFactor(solutionVolume);
    const dropsPerMin = (pumpRate * dripFactor) / 60;

    // Display
    const doseBaseUnit = doseUnit.replace('/hr','').replace('/min','').replace('/kg','').trim();
    document.getElementById('manualTotalDrug').textContent = PersianNumbers.formatNumber(drugAmount, 1);
    document.getElementById('manualTotalDrugUnit').innerHTML = `<span class="latin-inline">${drugUnit}</span>`;
    document.getElementById('manualConcentration').textContent = PersianNumbers.formatNumber(concentration, 3);
    document.getElementById('manualConcentrationUnit').innerHTML = `<span class="latin-inline">${doseBaseUnit}/cc</span>`;
    document.getElementById('manualPumpRate').textContent = PersianNumbers.formatNumber(pumpRate, 2);

    const dripRateEl = document.getElementById('manualDripRate');
    const dripLabelEl = document.getElementById('manualDripLabel');
    if (dripRateEl) dripRateEl.textContent = PersianNumbers.formatNumber(dropsPerMin, 1);
    if (dripLabelEl) dripLabelEl.textContent = 'سرعت قطره (' + dripLabel + ')';

    const durationEl = document.getElementById('manualDuration');
    if (durationEl) durationEl.textContent = PersianNumbers.formatNumber(duration, 1) + ' ساعت';

    document.getElementById('manualResults').style.display = 'block';
    haptic(40);
    showToast('موفق', 'محاسبه با موفقیت انجام شد', 'success');
    setTimeout(() => document.getElementById('manualResults')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}


// ============================================
// TAB MANAGEMENT
// ============================================
function switchTab(tabName) {
    const tabItems = document.querySelectorAll('.tab-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabItems.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    tabPanes.forEach(pane => {
        const isActive = pane.id === tabName + 'Tab';
        pane.classList.toggle('active', isActive);
        pane.style.display = isActive ? 'block' : 'none';
    });
    AppState.currentTab = tabName;
    if (tabName === 'drugs') loadDrugLibrary();
    if (tabName === 'tools') {
        initializeTools();
        initializeConverters();
    }
}

// ============================================
// THEME
// ============================================
function syncThemeModeButtons() {
    const mode = AppState.settings.themeMode || 'light';
    document.querySelectorAll('#themeModeButtons .theme-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

// ============================================
// THEME MODE (Light / Dark / Auto)
// ============================================
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyThemeMode() {
    const mode = AppState.settings.themeMode || 'light';
    const shouldBeDark = mode === 'dark' ? true : mode === 'auto' ? systemPrefersDark.matches : false;
    AppState.settings.darkMode = shouldBeDark;
    AppState.theme = shouldBeDark ? 'dark' : 'light';
    applySettings();
    if (DOM.darkModeToggle) DOM.darkModeToggle.checked = shouldBeDark;
    localStorage.setItem('theme', AppState.theme);
    saveSettings();
    syncThemeModeButtons();
}

function setupThemeModeListener() {
    systemPrefersDark.addEventListener('change', () => {
        if (AppState.settings.themeMode === 'auto') applyThemeMode();
    });
}

function toggleTheme() {
    AppState.theme = AppState.theme === 'light' ? 'dark' : 'light';
    document.body.classList.toggle('dark-mode', AppState.theme === 'dark');
    AppState.settings.darkMode = AppState.theme === 'dark';
    AppState.settings.themeMode = AppState.theme === 'dark' ? 'dark' : 'light';
    saveSettings();
    const meta = document.getElementById('themeColorMeta');
    if (meta) meta.content = AppState.theme === 'dark' ? '#1f2937' : '#ffffff';
    applyTheme(AppState.settings.colorTheme || 'default');
    const icon = DOM.themeToggle.querySelector('i');
    if (icon) icon.className = AppState.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    if (DOM.darkModeToggle) DOM.darkModeToggle.checked = AppState.theme === 'dark';
    localStorage.setItem('theme', AppState.theme);
    fixVolumeButtonColors();
    syncThemeModeButtons();
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    AppState.theme = savedTheme;
    document.body.classList.toggle('dark-mode', AppState.theme === 'dark');
    const icon = DOM.themeToggle?.querySelector('i');
    if (icon) icon.className = AppState.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    if (DOM.darkModeToggle) DOM.darkModeToggle.checked = AppState.theme === 'dark';
    fixVolumeButtonColors();
    const savedColor = AppState.settings.colorTheme || 'default';
    if (savedColor !== 'default') applyTheme(savedColor);
}

// ============================================
// CONVERTERS — bidirectional live
// ============================================
function initializeConverters() {
    const defaults = { percentageValue:'5', percentageVolume:'100', dripVolume:'500', dripTime:'8', tempC:'37', weightKg:'70' };
    Object.entries(defaults).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });
    convertPercentageLive();
    calculateDripRateLive();
    convertTempLive('c');
    convertWeightLive('kg');
}

const ELECTROLYTE_DATA = {
    sodium:             { mw: 23,  valence: 1 },
    potassium:          { mw: 39,  valence: 1 },
    calcium:            { mw: 20,  valence: 2 },
    magnesium:          { mw: 12,  valence: 2 },
    sodium_bicarbonate: { mw: 84,  valence: 1 }
};

function convertElectrolyteLive(source) {
    const element = document.getElementById('electrolyteElement').value;
    const data = ELECTROLYTE_DATA[element];
    if (!data) return;
    const meqEl = document.getElementById('electrolyteMeq');
    const mgEl  = document.getElementById('electrolyteMg');
    const resEl = document.getElementById('electrolyteResult');
    const eqWeight = data.mw / data.valence;
    if (source === 'meq') {
        const meq = parseFloat(meqEl.value);
        if (!isNaN(meq) && meq >= 0) mgEl.value = parseFloat((meq * eqWeight).toFixed(3));
    } else if (source === 'mg') {
        const mg = parseFloat(mgEl.value);
        if (!isNaN(mg) && mg >= 0) meqEl.value = parseFloat((mg / eqWeight).toFixed(3));
    }
    const meq = parseFloat(meqEl.value) || 0;
    const mg  = parseFloat(mgEl.value)  || 0;
    if (meq > 0 || mg > 0) {
        resEl.innerHTML = renderConverterResult([
            { label: 'mEq', value: meq.toFixed(2) },
            { label: 'mg',  value: mg.toFixed(2) },
            { label: 'وزن اکی‌والان', value: eqWeight.toFixed(1) + ' mg/mEq' }
        ]);
        resEl.style.display = 'block';
    }
}

function convertUnitsLive(source) {
    const fromSel = document.getElementById('unitFromSelect');
    const toSel   = document.getElementById('unitToSelect');
    const fromEl  = document.getElementById('unitFromVal');
    const toEl    = document.getElementById('unitToVal');
    const resEl   = document.getElementById('unitResult');
    const toMcg = { mcg: 1, mg: 1000, g: 1000000 };
    const fromUnit = fromSel.value, toUnit = toSel.value;
    if (source === 'from') {
        const val = parseFloat(fromEl.value);
        if (!isNaN(val) && val >= 0) {
            const mcg = val * toMcg[fromUnit];
            toEl.value = parseFloat((mcg / toMcg[toUnit]).toFixed(6));
        }
    } else if (source === 'to') {
        const val = parseFloat(toEl.value);
        if (!isNaN(val) && val >= 0) {
            const mcg = val * toMcg[toUnit];
            fromEl.value = parseFloat((mcg / toMcg[fromUnit]).toFixed(6));
        }
    }
    const fromVal = parseFloat(fromEl.value) || 0;
    const toVal   = parseFloat(toEl.value)   || 0;
    if (fromVal > 0 || toVal > 0) {
        resEl.innerHTML = renderConverterResult([
            { label: fromUnit, value: fromVal.toFixed(4) },
            { label: toUnit,   value: toVal.toFixed(4) }
        ]);
        resEl.style.display = 'block';
    }
}

function convertPercentageLive() {
    const pct = parseFloat(document.getElementById('percentageValue').value) || 0;
    const vol = parseFloat(document.getElementById('percentageVolume').value) || 100;
    const resEl = document.getElementById('percentageResult');
    if (pct <= 0) { resEl.style.display = 'none'; return; }
    const grams = (pct / 100) * vol;
    const mgPerMl = (pct / 100) * 1000;
    resEl.innerHTML = renderConverterResult([
        { label: 'مقدار دارو در محلول', value: grams.toFixed(2) + ' g' },
        { label: 'غلظت', value: mgPerMl.toFixed(1) + ' mg/mL' },
        { label: 'غلظت میکروگرمی', value: (mgPerMl * 1000).toFixed(0) + ' mcg/mL' }
    ]);
    resEl.style.display = 'block';
}

function calculateDripRateLive() {
    const vol    = parseFloat(document.getElementById('dripVolume').value) || 0;
    const time   = parseFloat(document.getElementById('dripTime').value)   || 0;
    const factor = parseInt(document.getElementById('dripFactorSelect').value) || 20;
    const resEl  = document.getElementById('dripResult');
    if (vol <= 0 || time <= 0) { resEl.style.display = 'none'; return; }
    const mlPerHr   = vol / time;
    const dropsMin  = (mlPerHr * factor) / 60;
    const drops15s  = dropsMin / 4;
    resEl.innerHTML = renderConverterResult([
        { label: 'سرعت پمپ',         value: mlPerHr.toFixed(1) + ' mL/hr' },
        { label: 'قطره در دقیقه',     value: dropsMin.toFixed(1) + ' gtt/min' },
        { label: 'قطره در ۱۵ ثانیه',  value: Math.round(drops15s) + ' قطره (شمارش در ۱۵ ثانیه)' }
    ]);
    resEl.style.display = 'block';
}

function convertTempLive(source) {
    const cEl   = document.getElementById('tempC');
    const fEl   = document.getElementById('tempF');
    const resEl = document.getElementById('tempResult');
    if (!cEl || !fEl) return;
    if (source === 'c') {
        const c = parseFloat(cEl.value);
        if (!isNaN(c)) fEl.value = parseFloat(((c * 9/5) + 32).toFixed(1));
    } else {
        const f = parseFloat(fEl.value);
        if (!isNaN(f)) cEl.value = parseFloat(((f - 32) * 5/9).toFixed(1));
    }
    const c = parseFloat(cEl.value) || 0;
    let note = '';
    if (c < 35)       note = '🔵 هیپوترمی';
    else if (c < 36.5) note = '⚪ زیر نرمال';
    else if (c <= 37.5) note = '🟢 طبیعی';
    else if (c <= 38.5) note = '🟡 تب خفیف';
    else if (c <= 40)  note = '🟠 تب';
    else               note = '🔴 تب شدید — اورژانسی';
    resEl.innerHTML = renderConverterResult([
        { label: 'سلسیوس',  value: (parseFloat(cEl.value) || 0).toFixed(1) + ' °C' },
        { label: 'فارنهایت', value: (parseFloat(fEl.value) || 0).toFixed(1) + ' °F' },
        { label: 'وضعیت',   value: note }
    ]);
    resEl.style.display = 'block';
}

function convertWeightLive(source) {
    const kgEl  = document.getElementById('weightKg');
    const lbEl  = document.getElementById('weightLb');
    const gEl   = document.getElementById('weightG');
    const resEl = document.getElementById('weightResult');
    if (!kgEl || !lbEl || !gEl) return;
    let kg = 0;
    if (source === 'kg') kg = parseFloat(kgEl.value) || 0;
    else if (source === 'lb') { kg = (parseFloat(lbEl.value) || 0) / 2.20462; kgEl.value = kg.toFixed(2); }
    else if (source === 'g')  { kg = (parseFloat(gEl.value) || 0) / 1000; kgEl.value = kg.toFixed(3); }
    if (kg > 0) {
        lbEl.value = (kg * 2.20462).toFixed(1);
        gEl.value  = (kg * 1000).toFixed(0);
        resEl.innerHTML = renderConverterResult([
            { label: 'کیلوگرم', value: kg.toFixed(2) + ' kg' },
            { label: 'پوند',    value: (kg * 2.20462).toFixed(1) + ' lb' },
            { label: 'گرم',     value: (kg * 1000).toFixed(0) + ' g' }
        ]);
        resEl.style.display = 'block';
    }
}

function renderConverterResult(rows) {
    return '<div class="conv-result-list">' + rows.map(r =>
        '<div class="conv-result-row"><span class="conv-result-label">' + r.label + '</span><strong class="conv-result-value">' + r.value + '</strong></div>'
    ).join('') + '</div>';
}

function convertElectrolyte() { convertElectrolyteLive('meq'); }
function convertPercentage() { convertPercentageLive(); }
function convertUnits() { convertUnitsLive('from'); }
function calculateDripRate() { calculateDripRateLive(); }

// ============================================
// TOOLS
// ============================================
function initializeTools() {
    const defaults = { bmiWeight:'70', bmiHeight:'170', bsaWeight:'70', bsaHeight:'170', ibwHeight:'170', crclAge:'40', crclWeight:'70', crclValue:'1.0' };
    Object.entries(defaults).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });
    ['compatDrug1','compatDrug2','doseCalcDrugPicker'].forEach(selId => {
        const sel = document.getElementById(selId);
        if (!sel || sel.options.length > 1) return;
        Object.values(drugDatabase).forEach(drug => {
            const opt = document.createElement('option');
            opt.value = drug.id;
            opt.textContent = drug.persianName + ' (' + drug.englishName + ')';
            sel.appendChild(opt);
        });
    });
}

function calculateBMI() {
    const weight = PersianNumbers.parseNumber(document.getElementById('bmiWeight').value);
    const height = PersianNumbers.parseNumber(document.getElementById('bmiHeight').value);
    const resultDiv = document.getElementById('bmiResult');
    if (!weight || !height) { showToast('خطا', 'لطفاً وزن و قد را وارد کنید', 'error'); resultDiv.innerHTML = ''; resultDiv.style.display = 'none'; return; }
    const bmi = weight / Math.pow(height / 100, 2);
    let cat, color;
    if (bmi < 18.5)      { cat = 'کمبود وزن';  color = '#60a5fa'; }
    else if (bmi < 25)   { cat = 'طبیعی';       color = '#34d399'; }
    else if (bmi < 30)   { cat = 'اضافه وزن';   color = '#fbbf24'; }
    else                 { cat = 'چاقی';         color = '#f87171'; }
    resultDiv.innerHTML = renderConverterResult([
        { label: 'BMI', value: PersianNumbers.formatNumber(bmi, 1) + ' kg/m²' },
        { label: 'وضعیت', value: `<span style="color:${color};font-weight:700;">${cat}</span>` }
    ]);
    resultDiv.style.display = 'block';
    refreshAccordion(resultDiv);
}

function calculateBSA() {
    const weight = PersianNumbers.parseNumber(document.getElementById('bsaWeight').value);
    const height = PersianNumbers.parseNumber(document.getElementById('bsaHeight').value);
    const formula = document.getElementById('bsaFormula').value;
    const resultDiv = document.getElementById('bsaResult');
    if (!weight || !height) { showToast('خطا', 'لطفاً وزن و قد را وارد کنید', 'error'); resultDiv.innerHTML = ''; resultDiv.style.display = 'none'; return; }
    let bsa;
    if (formula === 'mosteller') bsa = Math.sqrt((weight * height) / 3600);
    else if (formula === 'dubois') bsa = 0.007184 * Math.pow(weight, 0.425) * Math.pow(height, 0.725);
    else bsa = 0.024265 * Math.pow(weight, 0.5378) * Math.pow(height, 0.3964);
    resultDiv.innerHTML = renderConverterResult([
        { label: 'سطح بدن (BSA)', value: PersianNumbers.formatNumber(bsa, 3) + ' m²' },
        { label: 'فرمول', value: formula === 'mosteller' ? 'Mosteller' : formula === 'dubois' ? 'DuBois' : 'Haycock' }
    ]);
    resultDiv.style.display = 'block';
    refreshAccordion(resultDiv);
}

function calculateIBW() {
    const height = PersianNumbers.parseNumber(document.getElementById('ibwHeight').value);
    const gender = document.getElementById('ibwGender').value;
    const formula = document.getElementById('ibwFormula').value;
    const resultDiv = document.getElementById('ibwResult');
    if (!height) { showToast('خطا', 'لطفاً قد را وارد کنید', 'error'); resultDiv.innerHTML = ''; resultDiv.style.display = 'none'; return; }
    const hIn = height / 2.54;
    let ibw;
    if (formula === 'devine') ibw = gender === 'male' ? 50 + 2.3 * (hIn - 60) : 45.5 + 2.3 * (hIn - 60);
    else if (formula === 'robinson') ibw = gender === 'male' ? 52 + 1.9 * (hIn - 60) : 49 + 1.7 * (hIn - 60);
    else ibw = gender === 'male' ? 56.2 + 1.41 * (hIn - 60) : 53.1 + 1.36 * (hIn - 60);
    resultDiv.innerHTML = renderConverterResult([
        { label: 'وزن ایده‌آل (IBW)', value: PersianNumbers.formatNumber(ibw, 1) + ' kg' },
        { label: 'فرمول', value: formula.charAt(0).toUpperCase() + formula.slice(1) }
    ]);
    resultDiv.style.display = 'block';
    refreshAccordion(resultDiv);
}

function calculateCrCl() {
    const age = PersianNumbers.parseNumber(document.getElementById('crclAge').value);
    const weight = PersianNumbers.parseNumber(document.getElementById('crclWeight').value);
    const creatinine = PersianNumbers.parseNumber(document.getElementById('crclValue').value);
    const gender = document.getElementById('crclGender').value;
    const resultDiv = document.getElementById('crclResult');
    if (!age || !weight || !creatinine) { showToast('خطا', 'لطفاً تمامی مقادیر را وارد کنید', 'error'); resultDiv.innerHTML = ''; resultDiv.style.display = 'none'; return; }
    let crcl = ((140 - age) * weight) / (72 * creatinine);
    if (gender === 'female') crcl *= 0.85;
    let fn, fnColor;
    if (crcl > 90)       { fn = 'طبیعی';         fnColor = '#34d399'; }
    else if (crcl > 60)  { fn = 'کاهش خفیف';     fnColor = '#fbbf24'; }
    else if (crcl > 30)  { fn = 'کاهش متوسط';    fnColor = '#f97316'; }
    else if (crcl > 15)  { fn = 'کاهش شدید';     fnColor = '#f87171'; }
    else                 { fn = 'نارسایی کلیه';   fnColor = '#ef4444'; }
    resultDiv.innerHTML = renderConverterResult([
        { label: 'کلیرانس کراتینین', value: PersianNumbers.formatNumber(crcl, 0) + ' mL/min' },
        { label: 'وضعیت کلیه', value: `<span style="color:${fnColor};font-weight:700;">${fn}</span>` },
        { label: 'توجه', value: crcl < 30 ? 'تنظیم دوز داروهای کلیوی ضروری است' : 'دوز داروها را بر اساس CrCl بررسی کنید' }
    ]);
    resultDiv.style.display = 'block';
    refreshAccordion(resultDiv);
}

function checkCompatibility() {
    const drug1Id = document.getElementById('compatDrug1').value;
    const drug2Id = document.getElementById('compatDrug2').value;
    const solution = document.getElementById('compatSolution').value;
    const resultDiv = document.getElementById('compatResult');
    if (!drug1Id || !drug2Id) { showToast('خطا', 'لطفاً هر دو دارو را انتخاب کنید', 'error'); resultDiv.innerHTML = ''; resultDiv.style.display = 'none'; return; }
    if (drug1Id === drug2Id) {
        resultDiv.innerHTML = '<div class="compat-result-box warn"><i class="fas fa-info-circle"></i><span>داروهای یکسان انتخاب شده‌اند</span></div>';
        resultDiv.style.display = 'block'; return;
    }
    const d1 = drugDatabase[drug1Id], d2 = drugDatabase[drug2Id];
    if (!d1 || !d2) { resultDiv.textContent = 'اطلاعات دارو یافت نشد'; resultDiv.style.display = 'block'; return; }

    const solMap = { NS: 'N.S', D5W: 'D5W', DS: 'D/S', RL: 'RL' };
    const solKey = solMap[solution] || solution;
    const d1SolOk = d1.solutionType.some(s => s.replace(/[\s.\/]/g,'').toLowerCase() === solKey.replace(/[\s.\/]/g,'').toLowerCase() || d1.solutionType.includes(solution));
    const d2SolOk = d2.solutionType.some(s => s.replace(/[\s.\/]/g,'').toLowerCase() === solKey.replace(/[\s.\/]/g,'').toLowerCase() || d2.solutionType.includes(solution));

    const d2EnglishLower = d2.englishName.toLowerCase();
    const d1EnglishLower = d1.englishName.toLowerCase();
    const d1Compatibles = (d1.ySiteCompatibilities?.compatible || []).map(s => s.toLowerCase());
    const d1Incompatibles = (d1.ySiteCompatibilities?.incompatible || []).map(s => s.toLowerCase());
    const d2Compatibles = (d2.ySiteCompatibilities?.compatible || []).map(s => s.toLowerCase());
    const d2Incompatibles = (d2.ySiteCompatibilities?.incompatible || []).map(s => s.toLowerCase());

    const d1SaysCompat = d1Compatibles.some(s => s.includes(d2EnglishLower) || s.includes(d2.persianName));
    const d1SaysIncompat = d1Incompatibles.some(s => s.includes(d2EnglishLower) || s.includes(d2.persianName));
    const d2SaysCompat = d2Compatibles.some(s => s.includes(d1EnglishLower) || s.includes(d1.persianName));
    const d2SaysIncompat = d2Incompatibles.some(s => s.includes(d1EnglishLower) || s.includes(d1.persianName));

    const isIncompat = d1SaysIncompat || d2SaysIncompat;
    const isCompat = (d1SaysCompat || d2SaysCompat) && !isIncompat;

    let solNote = '';
    if (!d1SolOk) solNote = `<div class="compat-sol-note"><i class="fas fa-exclamation-triangle"></i> ${d1.persianName} معمولاً با ${solution} استفاده نمی‌شود</div>`;
    else if (!d2SolOk) solNote = `<div class="compat-sol-note"><i class="fas fa-exclamation-triangle"></i> ${d2.persianName} معمولاً با ${solution} استفاده نمی‌شود</div>`;

    let html = '';
    if (isIncompat) {
        html = `<div class="compat-result-box danger">
            <i class="fas fa-times-circle"></i>
            <div>
                <strong>${d1.persianName} و ${d2.persianName} ناسازگار هستند</strong>
                <span>از تزریق همزمان در یک خط خودداری کنید</span>
            </div>
        </div>`;
    } else if (isCompat) {
        html = `<div class="compat-result-box success">
            <i class="fas fa-check-circle"></i>
            <div>
                <strong>${d1.persianName} و ${d2.persianName} سازگار هستند (Y-Site)</strong>
                <span>تزریق همزمان در یک خط امکان‌پذیر است</span>
            </div>
        </div>`;
    } else {
        html = `<div class="compat-result-box warn">
            <i class="fas fa-question-circle"></i>
            <div>
                <strong>اطلاعات کافی در پایگاه داده موجود نیست</strong>
                <span>قبل از تزریق همزمان با داروساز مشورت کنید</span>
            </div>
        </div>`;
    }
    resultDiv.innerHTML = html + solNote;
    resultDiv.style.display = 'block';
}

function calculateDose() {
    const needed = PersianNumbers.parseNumber(document.getElementById('doseNeeded').value);
    const concentration = PersianNumbers.parseNumber(document.getElementById('doseConcentration').value);
    const vialVolume = PersianNumbers.parseNumber(document.getElementById('doseVialVolume').value);
    const unit = document.getElementById('doseUnit')?.value || 'mg';
    const resultDiv = document.getElementById('doseResult');
    if (!needed || !concentration || !vialVolume) { showToast('خطا', 'لطفاً تمامی مقادیر را وارد کنید', 'error'); resultDiv.innerHTML = ''; resultDiv.style.display = 'none'; return; }
    if (concentration === 0) { resultDiv.innerHTML = 'غلظت نمی‌تواند صفر باشد'; resultDiv.style.display = 'block'; return; }
    const volumeNeeded = needed / concentration;
    const vialsNeeded = Math.ceil(volumeNeeded / vialVolume);
    const syringes = [1, 2, 3, 5, 10, 20, 50];
    const bestSyringe = syringes.find(s => s >= volumeNeeded) || 50;
    const vialText = vialsNeeded > 1 ? ` — ${vialsNeeded} ویال` : ' — ۱ ویال';
    resultDiv.innerHTML = `
        <div class="dose-calc-result">
            <div class="dose-calc-row"><span>حجم مورد نیاز:</span><strong>${PersianNumbers.formatNumber(volumeNeeded, 2)} mL${vialText}</strong></div>
            <div class="dose-calc-row"><span>سرنگ پیشنهادی:</span><strong>${bestSyringe} mL</strong></div>
        </div>`;
    resultDiv.style.display = 'block';
}

function populateDoseCalcFromDrug() {
    const sel = document.getElementById('doseCalcDrugPicker');
    if (!sel) return;
    const drugId = sel.value;
    if (!drugId) return;
    const drug = drugDatabase[drugId];
    if (!drug) return;
    const amp = drug.ampouleOptions[0];
    const conc = amp.strength / amp.volume;
    const concEl = document.getElementById('doseConcentration');
    const vialEl = document.getElementById('doseVialVolume');
    const unitEl = document.getElementById('doseUnit');
    const concUnitEl = document.getElementById('doseConcentrationUnit');
    if (concEl) concEl.value = parseFloat(conc.toFixed(3));
    if (vialEl) vialEl.value = amp.volume;
    if (unitEl) unitEl.value = amp.unit || 'mg';
    if (concUnitEl) concUnitEl.textContent = (amp.unit || 'mg') + '/mL';
    showToast('بارگذاری شد', drug.persianName + ' — غلظت: ' + parseFloat(conc.toFixed(3)) + ' ' + (amp.unit||'mg') + '/mL', 'success');
}

// ============================================
// DRUG QUICK REFERENCE — Accordion style
// ============================================
function loadDrugLibrary() {
    const container = document.getElementById('drugLibrary');
    if (!container) return;
    if (container.children.length > 0) { wireDrugLibrarySearch(); return; }

    Object.values(drugDatabase).forEach(drug => {
        let doseRangeDisplay = '--';
        if (drug.typicalDoseRange) {
            const minFormatted = drug.typicalDoseRange.min.toFixed(1);
            const maxFormatted = drug.typicalDoseRange.max.toFixed(1);
            doseRangeDisplay = `<span dir="ltr" style="display:inline-block; unicode-bidi:isolate; font-family: monospace;">${minFormatted}–${maxFormatted} ${drug.typicalDoseRange.unit}</span>`;
        }
        const maxConc = drug.maxSafeConcentration || '--';
        const solutions = drug.solutionType.join(' / ');
        const compatible = (drug.ySiteCompatibilities?.compatible || []).slice(0, 5);
        const incompatible = (drug.ySiteCompatibilities?.incompatible || []).slice(0, 5);

        const ampoulesHTML = drug.ampouleOptions.map(a =>
            '<div class="qref-ampoule-item"><i class="fas fa-vial"></i><span dir="ltr">' + a.label + '</span></div>'
        ).join('');

        const item = document.createElement('div');
        item.className = 'accordion-item qref-accordion-item';
        item.style.setProperty('--drug-color', drug.color);
        item.dataset.drugId = drug.id;
        item.dataset.drugName = drug.persianName.toLowerCase() + ' ' + drug.englishName.toLowerCase();
        item.innerHTML =
            '<div class="qref-row" data-body-id="drug-body-' + drug.id + '">' +
                '<div class="qref-acc-icon" style="background:linear-gradient(135deg,' + drug.color + ',' + drug.color + 'bb)">' +
                    renderDrugIcon(drug.icon) +
                '</div>' +
                '<div class="qref-title-block">' +
                    '<span class="qref-name">' + drug.persianName + '</span>' +
                    '<span class="qref-english">' + drug.englishName + ' — ' + drug.category + '</span>' +
                '</div>' +
                '<button class="qref-calc-btn" onclick="event.stopPropagation();selectDrug(\'' + drug.id + '\');switchTab(\'calculator\')">' +
                    '<i class="fas fa-calculator"></i>' +
                    '<span>محاسبه</span>' +
                '</button>' +
                '<div class="qref-chevron">' +
                    '<i class="fas fa-chevron-down"></i>' +
                '</div>' +
            '</div>' +
            '<div class="accordion-body qref-acc-body" id="drug-body-' + drug.id + '">' +
                '<div class="qref-info-grid">' +
                    '<div class="qref-info-row"><span class="qref-info-label"><i class="fas fa-pills"></i> دوز معمول</span><span class="qref-info-val">' + doseRangeDisplay + '</span></div>' +
                    '<div class="qref-info-row"><span class="qref-info-label"><i class="fas fa-flask"></i> حداکثر غلظت</span><span class="qref-info-val">' + maxConc + '</span></div>' +
                    '<div class="qref-info-row"><span class="qref-info-label"><i class="fas fa-droplet"></i> محلول‌های سازگار</span><span class="qref-info-val">' + solutions + '</span></div>' +
                '</div>' +
                '<div class="qref-ampoule-section">' +
                    '<div class="qref-ampoule-title"><i class="fas fa-syringe"></i> آمپول‌های موجود</div>' +
                    '<div class="qref-ampoule-list">' + ampoulesHTML + '</div>' +
                '</div>' +
                (compatible.length || incompatible.length ? (
                    '<div class="qref-compat-grid">' +
                        '<div class="qref-compat-col compatible">' +
                            '<div class="qref-compat-title"><i class="fas fa-check-circle"></i> سازگار (Y-Site)</div>' +
                            (compatible.length ? compatible.map(d => '<div class="qref-compat-item">' + d + '</div>').join('') : '<div class="qref-compat-item muted">—</div>') +
                        '</div>' +
                        '<div class="qref-compat-col incompatible">' +
                            '<div class="qref-compat-title"><i class="fas fa-times-circle"></i> ناسازگار</div>' +
                            (incompatible.length ? incompatible.map(d => '<div class="qref-compat-item">' + d + '</div>').join('') : '<div class="qref-compat-item muted">—</div>') +
                        '</div>' +
                    '</div>'
                ) : '') +
                (drug.cautions && drug.cautions.length ? (
                    '<div class="qref-warnings">' +
                        '<div class="qref-warnings-title"><i class="fas fa-exclamation-triangle"></i> هشدارها</div>' +
                        drug.cautions.slice(0, 3).map(c => '<div class="qref-warning-item">' + c + '</div>').join('') +
                    '</div>'
                ) : '') +
            '</div>';

        container.appendChild(item);
    });
    wireDrugLibrarySearch();
}

function wireDrugLibrarySearch() {
    const input = document.getElementById('librarySearch');
    const container = document.getElementById('drugLibrary');
    if (!input || !container || input.dataset.wired) return;
    input.dataset.wired = 'true';
    input.addEventListener('input', () => {
        const term = input.value.trim().toLowerCase();
        container.querySelectorAll('.qref-accordion-item').forEach(item => {
            const name = (item.dataset.drugName || '');
            item.style.display = (!term || name.includes(term)) ? '' : 'none';
        });
    });

    if (!container.dataset.delegated) {
        container.dataset.delegated = 'true';
        container.addEventListener('click', (e) => {
            if (e.target.closest('.qref-calc-btn')) return;
            const row = e.target.closest('.qref-row');
            if (row && row.dataset.bodyId) {
                toggleAccordionById(row.dataset.bodyId);
            }
        });
    }
}

// ============================================
// UTILITIES
// ============================================
function showToast(title, message, type = 'info') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const icons = { success: 'fas fa-check-circle', error: 'fas fa-times-circle', warning: 'fas fa-exclamation-triangle', info: 'fas fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="toast-icon ${icons[type]}"></i>
        <div class="toast-content"><div class="toast-title">${title}</div><div class="toast-message">${message}</div></div>
        <button class="toast-close">&times;</button>
    `;
    document.body.appendChild(toast);
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

function updateStats() {}
function updateCalculationStats() { AppState.calculationsToday++; }

function saveCalculation(totalDrug, concentration, pumpRate, duration) {
    const history = JSON.parse(localStorage.getItem('calculationHistory') || '[]');
    history.unshift({
        id: Date.now(),
        drug: AppState.selectedDrug,
        drugName: drugDatabase[AppState.selectedDrug].persianName,
        dose: AppState.desiredDose,
        weight: AppState.patientWeight,
        totalDrug, concentration, pumpRate, duration,
        timestamp: new Date().toISOString()
    });
    if (history.length > 50) history.pop();
    localStorage.setItem('calculationHistory', JSON.stringify(history));
}

function loadHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    const history = JSON.parse(localStorage.getItem('calculationHistory') || '[]');
    if (history.length === 0) { historyList.innerHTML = '<div class="empty-history">تاریخچه‌ای یافت نشد</div>'; return; }
    historyList.innerHTML = '';
    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.title = 'برای بازیابی کلیک کنید';
        div.innerHTML = `
            <div class="history-drug">${item.drugName} <span class="history-restore-hint"><i class="fas fa-rotate-left"></i></span></div>
            <div class="history-details">
                <div>دوز: ${PersianNumbers.formatNumber(item.dose, 2)}</div>
                <div>سرعت پمپ: <span class="latin-inline">${PersianNumbers.formatNumber(item.pumpRate, 2)} cc/hr</span></div>
                <div class="history-time">${PersianNumbers.toLatin(new Date(item.timestamp).toLocaleDateString('fa-IR'))} — ${new Date(item.timestamp).toLocaleTimeString('fa-IR', {hour:'2-digit', minute:'2-digit'})}</div>
            </div>
            <div class="history-restore-bar">بازیابی این محاسبه</div>
        `;
        div.addEventListener('click', () => {
            restoreFromHistory(item);
        });
        historyList.appendChild(div);
    });
}

// ============================================
// REVERSE MODE
// ============================================
function updateReverseUI() {
    const doseLabel = document.querySelector('#calculatorControls .control-group:last-of-type > label');
    const unitEl = document.getElementById('orderUnit');
    const calcBtnLabel = document.querySelector('#calculateBtn span');
    const reverseRow = document.querySelector('.reverse-toggle-row');
    if (AppState.reverseMode) {
        if (DOM.reverseIosToggle) DOM.reverseIosToggle.classList.add('on');
        if (reverseRow) reverseRow.classList.add('active');
        if (doseLabel) doseLabel.innerHTML = '<i class="fas fa-pump-medical"></i> سرعت پمپ';
        if (unitEl) unitEl.textContent = 'cc/hour';
        if (DOM.doctorOrder) DOM.doctorOrder.placeholder = '0';
        if (calcBtnLabel) calcBtnLabel.textContent = 'محاسبه دوز دریافتی';
    } else {
        if (DOM.reverseIosToggle) DOM.reverseIosToggle.classList.remove('on');
        if (reverseRow) reverseRow.classList.remove('active');
        if (doseLabel) doseLabel.innerHTML = '<i class="fas fa-file-medical-alt"></i> دوز درخواستی';
        if (DOM.doctorOrder) DOM.doctorOrder.placeholder = '0';
        if (calcBtnLabel) calcBtnLabel.textContent = 'محاسبه سرعت پمپ';
        const drug = drugDatabase[AppState.selectedDrug];
        if (drug && unitEl) {
            unitEl.textContent = AppState.useWeight && drug.weightBased?.active
                ? drug.weightBased.unit
                : (drug.weightBased?.nonWeightUnit || drug.standardUnit);
        }
    }
}

// ============================================
// DOSE RANGE INDICATOR
// ============================================
function updateDoseRangeIndicator() {
    const drug = drugDatabase[AppState.selectedDrug];
    if (!drug || !drug.typicalDoseRange || AppState.reverseMode) {
        if (DOM.doseRangeIndicator) DOM.doseRangeIndicator.style.display = 'none';
        return;
    }
    const raw = DOM.doctorOrder?.value;
    if (!raw || raw.trim() === '') {
        if (DOM.doseRangeIndicator) DOM.doseRangeIndicator.style.display = 'none';
        return;
    }
    const val = PersianNumbers.parseNumber(raw);
    if (isNaN(val) || val <= 0) {
        if (DOM.doseRangeIndicator) DOM.doseRangeIndicator.style.display = 'none';
        return;
    }
    const { min, max, unit } = drug.typicalDoseRange;
    let status, color, text;
    if (val < min * 0.8) {
        status = 'low'; color = '#60a5fa';
        text = `پایین‌تر از محدوده معمول (${min}–${max} ${unit})`;
    } else if (val >= min * 0.8 && val <= max * 1.1) {
        status = 'ok'; color = '#34d399';
        text = `در محدوده معمول (${min}–${max} ${unit})`;
    } else if (val > max * 1.1 && val <= max * 1.5) {
        status = 'warn'; color = '#fbbf24';
        text = `بالاتر از محدوده معمول — بررسی شود`;
    } else {
        status = 'danger'; color = '#f87171';
        text = `خارج از محدوده ایمن — دوز را بررسی کنید`;
    }
    if (DOM.doseRangeDot) DOM.doseRangeDot.style.background = color;
    if (DOM.doseRangeText) { DOM.doseRangeText.textContent = text; DOM.doseRangeText.style.color = color; }
    if (DOM.doseRangeIndicator) DOM.doseRangeIndicator.style.display = 'flex';
}

// ============================================
// REVERSE CALCULATION
// ============================================
function calculateReverse() {
    const drug = drugDatabase[AppState.selectedDrug];
    if (!drug) { showToast('خطا', 'ابتدا یک دارو انتخاب کنید', 'error'); return; }
    const ampoule = drug.ampouleOptions[AppState.currentAmpouleIndex];
    const pumpRateVal = PersianNumbers.parseNumber(DOM.doctorOrder.value);
    if (!pumpRateVal || isNaN(pumpRateVal) || pumpRateVal <= 0) {
        DOM.doctorOrder.style.borderColor = 'var(--danger)';
        showToast('خطا', 'لطفاً سرعت پمپ را وارد کنید (cc/hour)', 'error');
        DOM.doctorOrder.focus();
        return;
    }
    DOM.doctorOrder.style.borderColor = '';
    const totalDrug = AppState.ampouleCount * ampoule.strength;
    const concentration = totalDrug / AppState.solutionVolume;
    let derivedDose = pumpRateVal * concentration;
    const unit = AppState.useWeight && drug.weightBased?.active ? drug.weightBased.unit : (drug.weightBased?.nonWeightUnit || drug.standardUnit);
    const isPerMin = unit && unit.toLowerCase().includes('min');
    if (isPerMin) derivedDose = derivedDose / 60;
    const isPerKg = unit && unit.toLowerCase().includes('kg');
    const weight = AppState.useWeight ? (parseFloat(DOM.patientWeight?.dataset.numericValue) || 1) : 1;
    if (isPerKg && AppState.useWeight) derivedDose = derivedDose / weight;
    const duration = AppState.solutionVolume / pumpRateVal;
    displayResultsReverse(totalDrug, concentration, pumpRateVal, derivedDose, duration, ampoule.unit, unit);
    generateStepByStepGuide(drug, totalDrug, concentration, pumpRateVal, derivedDose);
    displayWarnings(drug);
    displayCompatibility(drug);
    if (AppState.settings.saveHistory) saveCalculation(totalDrug, concentration, pumpRateVal, duration);
}

function displayResultsReverse(totalDrug, concentration, pumpRate, derivedDose, duration, ampUnit, doseUnit) {
    const drug = drugDatabase[AppState.selectedDrug];
    DOM.totalDrugAmount.textContent = PersianNumbers.formatNumber(totalDrug, 0);
    DOM.totalDrugUnit.innerHTML = `<span class="latin-inline">${ampUnit}</span>`;
    let concentrationDisplay, concentrationUnitDisplay;
    const _doseInMcg = (drug.standardUnit || '').startsWith('mcg');
    const _ampouleInMg = (drug.ampouleOptions[0]?.unit || '') === 'mg';
    if (_doseInMcg && _ampouleInMg) {
        concentrationDisplay = PersianNumbers.formatNumber(concentration * 1000, 2);
        concentrationUnitDisplay = 'mcg/cc';
    } else {
        concentrationDisplay = PersianNumbers.formatNumber(concentration, 2);
        concentrationUnitDisplay = `${ampUnit}/cc`;
    }
    DOM.concentrationResult.textContent = concentrationDisplay;
    DOM.concentrationUnit.innerHTML = `<span class="latin-inline">${concentrationUnitDisplay}</span>`;
    DOM.pumpRateResult.textContent = PersianNumbers.formatNumber(pumpRate, 2);
    DOM.pumpRateUnit.innerHTML = `<span class="latin-inline">cc/hour</span>`;
    DOM.durationResult.textContent = PersianNumbers.formatNumber(duration, 1);
    DOM.durationUnit.innerHTML = `<span class="persian-inline">ساعت</span>`;
    const highlightEl = document.querySelector('.result-item-enhanced.highlight');
    const pumpRateCard = document.getElementById('pumpRateResult')?.closest('.result-item-enhanced');
    if (highlightEl && pumpRateCard) {
        highlightEl.classList.remove('highlight');
    }
    if (pumpRateCard) {
        pumpRateCard.classList.add('highlight');
        const labelEl = pumpRateCard.querySelector('.result-label-enhanced');
        const valueEl = pumpRateCard.querySelector('.result-value-enhanced');
        const unitEl = pumpRateCard.querySelector('.result-unit-enhanced');
        if (labelEl) labelEl.textContent = 'دوز دریافتی';
        if (valueEl) { valueEl.textContent = PersianNumbers.formatNumber(derivedDose, 2); valueEl.style.color = 'white'; }
        if (unitEl) { unitEl.innerHTML = `<span class="latin-inline">${doseUnit || ampUnit}</span>`; }
    }
    if (DOM.resultsSection) {
        DOM.resultsSection.classList.add('show');
        DOM.resultsSection.style.display = 'block';
        setTimeout(() => DOM.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
}

// ============================================
// RESTORE FROM HISTORY
// ============================================
function restoreFromHistory(item) {
    if (drugDatabase[item.drug]) {
        selectDrug(item.drug);
        if (DOM.historyModal) { DOM.historyModal.classList.remove('active'); document.body.classList.remove('no-scroll'); }
        setTimeout(() => {
            if (DOM.doctorOrder) {
                DOM.doctorOrder.value = item.dose;
                DOM.doctorOrder.dataset.numericValue = item.dose;
                updateDoseRangeIndicator();
            }
            if (item.weight && DOM.patientWeight && DOM.weightCheckbox) {
                DOM.weightCheckbox.checked = true;
                AppState.useWeight = true;
                DOM.patientWeight.disabled = false;
                if (DOM.weightIosToggle) DOM.weightIosToggle.classList.add('on');
                if (DOM.weightInputRow) DOM.weightInputRow.style.display = 'flex';
                DOM.patientWeight.value = item.weight;
                DOM.patientWeight.dataset.numericValue = item.weight;
            }
            showToast('بازیابی شد', `محاسبه ${item.drugName} بازیابی شد`, 'success');
            haptic(40);
        }, 300);
    } else {
        showToast('خطا', 'این دارو در پایگاه داده یافت نشد', 'error');
    }
}

// ============================================
// EXPORT HISTORY
// ============================================
function exportHistory() {
    const history = JSON.parse(localStorage.getItem('calculationHistory') || '[]');
    if (history.length === 0) {
        showToast('اطلاع', 'تاریخچه‌ای برای خروجی وجود ندارد', 'info');
        return;
    }
    const lines = ['MedCalc Pro — تاریخچه محاسبات', '='.repeat(40), ''];
    history.forEach((item, i) => {
        const d = new Date(item.timestamp);
        const dateStr = d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', {hour:'2-digit', minute:'2-digit'});
        lines.push(`#${i + 1} — ${item.drugName}`);
        lines.push(`تاریخ: ${dateStr}`);
        lines.push(`دوز: ${item.dose}`);
        lines.push(`سرعت پمپ: ${parseFloat(item.pumpRate).toFixed(2)} cc/hr`);
        lines.push(`غلظت: ${parseFloat(item.concentration).toFixed(2)}`);
        lines.push(`مدت: ${parseFloat(item.duration).toFixed(1)} ساعت`);
        if (item.weight) lines.push(`وزن بیمار: ${item.weight} kg`);
        lines.push('-'.repeat(30));
        lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FoxiMed-History-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('خروجی گرفته شد', `${history.length} محاسبه ذخیره شد`, 'success');
}

// ============================================
// DRIP RATE CALCULATION
// ============================================
function getDripFactor(volumeCC) {
    if (volumeCC <= 100) return { factor: 60, label: 'میکروست — ۶۰ قطره/mL' };
    return { factor: 20, label: 'ماکروست — ۲۰ قطره/mL' };
}

function displayDripRate(pumpRate, volumeCC) {
    if (!DOM.dripRateRow || !DOM.dripRateResult || !DOM.dripRateLabel) return;
    const { factor, label } = getDripFactor(volumeCC);
    const dropsPerMin = (pumpRate * factor) / 60;
    DOM.dripRateResult.textContent = PersianNumbers.formatNumber(dropsPerMin, 1);
    DOM.dripRateLabel.textContent = 'سرعت قطره (' + label + ')';
    DOM.dripRateRow.style.display = 'flex';
}

// ============================================
// TAB BAR HEIGHT MEASUREMENT
// ============================================
function measureTabBarHeight() {
    const tabBar = document.querySelector('.tab-bar');
    const mainContent = document.querySelector('.main-content');
    if (!tabBar || !mainContent) return false;
    const rect = tabBar.getBoundingClientRect();
    const height = rect.height;
    if (height > 20) {
        mainContent.style.bottom = height + 'px';
        document.documentElement.style.setProperty('--tab-bar-height', height + 'px');
        return true;
    }
    return false;
}

function setupTabBarMeasurement() {
    if (!measureTabBarHeight()) {
        const delays = [0, 50, 150, 300, 600, 1000];
        delays.forEach(d => setTimeout(measureTabBarHeight, d));
    }
    window.addEventListener('resize', measureTabBarHeight);
    window.addEventListener('orientationchange', () => {
        setTimeout(measureTabBarHeight, 100);
        setTimeout(measureTabBarHeight, 400);
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(measureTabBarHeight, 200);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', measureTabBarHeight);
    }
}

// ============================================
// OFFLINE INDICATOR
// ============================================
function setupOfflineIndicator() {
    const bar = document.createElement('div');
    bar.id = 'offlineBar';
    bar.className = 'offline-bar';
    bar.innerHTML = '<i class="fas fa-wifi-slash"></i> <span>اتصال اینترنت قطع است — اپ به صورت آفلاین کار می‌کند</span>';
    bar.style.display = 'none';
    document.body.appendChild(bar);

    function update() {
        if (!navigator.onLine) {
            bar.style.display = 'flex';
            bar.classList.remove('online-flash');
        } else {
            bar.classList.add('online-flash');
            bar.innerHTML = '<i class="fas fa-wifi"></i> <span>اتصال برقرار شد</span>';
            setTimeout(() => { bar.style.display = 'none'; bar.innerHTML = '<i class="fas fa-wifi-slash"></i> <span>اتصال اینترنت قطع است — اپ به صورت آفلاین کار می‌کند</span>'; }, 2500);
        }
    }

    window.addEventListener('offline', update);
    window.addEventListener('online', update);
    if (!navigator.onLine) update();
}

// ============================================
// SWIPE GESTURE FOR TAB SWITCHING (Mobile)
// ============================================
function initSwipe() {
    if (window.innerWidth > 768) return;
    const container = document.querySelector('.main-content');
    if (!container) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    let swipeLocked = false;
    const minHorizontalDistance = 80;
    const maxVerticalDistance = 50;

    function isInsideHScrollable(el) {
        while (el && el !== container) {
            const style = window.getComputedStyle(el);
            const overflowX = style.overflowX;
            const canScrollH = overflowX === 'auto' || overflowX === 'scroll';
            if (canScrollH && el.scrollWidth > el.clientWidth + 2) return true;
            el = el.parentElement;
        }
        return false;
    }

    container.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
        swipeLocked = isInsideHScrollable(e.target);
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (swipeLocked) return;
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        const diffX = Math.abs(touchEndX - touchStartX);
        const diffY = Math.abs(touchEndY - touchStartY);
        if (diffX < minHorizontalDistance || diffY > diffX) return;
        const direction = (touchEndX - touchStartX) > 0 ? 'right' : 'left';
        const tabs = ['calculator', 'drugs', 'tools', 'voice'];
        const current = AppState.currentTab;
        let newIndex = tabs.indexOf(current);
        if (direction === 'right') {
            newIndex = (newIndex - 1 + tabs.length) % tabs.length;
        } else {
            newIndex = (newIndex + 1) % tabs.length;
        }
        if (newIndex !== tabs.indexOf(current)) {
            switchTab(tabs[newIndex]);
            haptic(20);
        }
    }, { passive: true });
}

// ============================================
// REVERSE TOOLTIP
// ============================================
function showReverseTooltip() {
    const overlay = DOM.reverseTooltip;
    if (!overlay) return;
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('visible'));
    const okBtn = document.getElementById('reverseTooltipOk');
    const close = () => {
        overlay.classList.remove('visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 350);
        localStorage.setItem('reverseTooltipSeen', 'true');
    };
    if (okBtn) okBtn.addEventListener('click', close, { once: true });
    overlay.querySelector('.reverse-tooltip-backdrop')?.addEventListener('click', close, { once: true });
}

// ============================================
// ONBOARDING
// ============================================
function setupOnboarding() {
    const overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return;

    const slidesContainer = document.getElementById('tutorialSlides');
    const dotsContainer = document.getElementById('tutorialDots');
    const nextBtn = document.getElementById('tutorialNextBtn');
    const skipBtn = document.getElementById('tutorialSkipBtn');
    const dontShowChk = document.getElementById('onboardingDontShow');

    const slides = slidesContainer ? Array.from(slidesContainer.querySelectorAll('.tutorial-slide')) : [];
    let current = 0;

    if (dotsContainer && slides.length) {
        slides.forEach((_, i) => {
            const dot = document.createElement('span');
            dot.className = 'tutorial-dot' + (i === 0 ? ' active' : '');
            dot.addEventListener('click', () => goTo(i));
            dotsContainer.appendChild(dot);
        });
    }

    function updateDots() {
        if (!dotsContainer) return;
        dotsContainer.querySelectorAll('.tutorial-dot').forEach((d, i) => {
            d.classList.toggle('active', i === current);
        });
    }

    function goTo(idx) {
        if (!slides.length) return;
        slides[current].classList.remove('active');
        current = Math.max(0, Math.min(idx, slides.length - 1));
        slides[current].classList.add('active');
        updateDots();
        const isLast = current === slides.length - 1;
        if (nextBtn) {
            nextBtn.innerHTML = isLast
                ? '<i class="fas fa-check"></i> <span>شروع</span>'
                : '<span>بعدی</span> <i class="fas fa-arrow-left"></i>';
        }
        haptic(15);
    }

    function closeTutorial() {
        overlay.classList.remove('visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 400);
        if (dontShowChk && dontShowChk.checked) localStorage.setItem('onboardingSeen', 'true');
    }

    if (nextBtn) nextBtn.addEventListener('click', () => {
        if (current < slides.length - 1) goTo(current + 1);
        else { haptic(30); closeTutorial(); }
    });
    if (skipBtn) skipBtn.addEventListener('click', () => { closeTutorial(); });
    overlay.querySelector('.onboarding-backdrop')?.addEventListener('click', closeTutorial);

    let touchStartX = 0;
    if (slidesContainer) {
        slidesContainer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
        slidesContainer.addEventListener('touchend', e => {
            const diff = e.changedTouches[0].screenX - touchStartX;
            if (Math.abs(diff) > 50) goTo(current + (diff < 0 ? 1 : -1));
        }, { passive: true });
    }

    const seen = localStorage.getItem('onboardingSeen');
    if (!seen) {
        setTimeout(() => {
            overlay.style.display = 'flex';
            requestAnimationFrame(() => overlay.classList.add('visible'));
        }, 3500);
    }
}

window.showTutorial = function() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.classList.contains('active')) {
        settingsModal.classList.remove('active');
        document.body.style.overflow = '';
    }
    const overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return;
    const slides = overlay.querySelectorAll('.tutorial-slide');
    slides.forEach((s, i) => s.classList.toggle('active', i === 0));
    const dots = overlay.querySelectorAll('.tutorial-dot');
    dots.forEach((d, i) => d.classList.toggle('active', i === 0));
    const nextBtn = document.getElementById('tutorialNextBtn');
    if (nextBtn) nextBtn.innerHTML = '<span>بعدی</span> <i class="fas fa-arrow-left"></i>';
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('visible'));
};

// ============================================
// UPDATE AVAILABLE BANNER
// ============================================
let _pendingWorker = null;

function showUpdateBanner() {
    if (document.getElementById('updateBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.className = 'update-banner';
    banner.innerHTML =
        '<div class="update-banner-icon"><i class="fas fa-rocket"></i></div>' +
        '<div class="update-banner-text">' +
            '<div class="update-banner-title">نسخه جدید FoxiMed آماده است</div>' +
            '<div class="update-banner-sub">برای دریافت آخرین تغییرات بروزرسانی کنید</div>' +
        '</div>' +
        '<button class="update-banner-btn" id="doUpdateBtn"><i class="fas fa-download"></i> بروزرسانی</button>' +
        '<button class="update-banner-dismiss" id="dismissBannerBtn"><i class="fas fa-times"></i></button>';
    document.body.appendChild(banner);
    haptic(40);

    document.getElementById('doUpdateBtn').addEventListener('click', () => {
        if (_pendingWorker) {
            _pendingWorker.postMessage({ type: 'SKIP_WAITING' });
        } else {
            window.location.reload();
        }
    });
    document.getElementById('dismissBannerBtn').addEventListener('click', () => {
        banner.style.animation = 'none';
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-10px) scale(0.96)';
        banner.style.transition = 'all 0.25s ease';
        setTimeout(() => banner.remove(), 260);
    });
}

function setupUpdateDetection() {
    if (!('serviceWorker' in navigator)) return;

    let firstInstall = localStorage.getItem('sw_first_install') === null;
    if (firstInstall) {
        localStorage.setItem('sw_first_install', 'true');
    }

    navigator.serviceWorker.ready.then(reg => {
        if (reg.waiting && !firstInstall) {
            _pendingWorker = reg.waiting;
            showUpdateBanner();
        }
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller && !firstInstall) {
                    _pendingWorker = newWorker;
                    showUpdateBanner();
                }
            });
        });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (localStorage.getItem('sw_first_install') === 'true') {
            localStorage.setItem('sw_first_install', 'false');
        } else {
            setTimeout(() => window.location.reload(), 300);
        }
    });
}

// ============================================
// THEME COLOR SYSTEM
// ============================================
const THEMES = {
    default: {
        light: {
            '--primary':          '#667eea',
            '--primary-dark':     '#5a67d8',
            '--primary-light':    'rgba(102,126,234,0.1)',
            '--gradient-primary': 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
            '--secondary':        '#f093fb',
        },
        dark: {
            '--primary':          '#60a5fa',
            '--primary-dark':     '#3b82f6',
            '--primary-light':    'rgba(96,165,250,0.15)',
            '--gradient-primary': 'linear-gradient(135deg,#60a5fa 0%,#34d399 100%)',
            '--secondary':        '#c084fc',
        }
    },
    fox: {
        light: {
            '--primary':          '#ea580c',
            '--primary-dark':     '#c2410c',
            '--primary-light':    'rgba(234,88,12,0.1)',
            '--gradient-primary': 'linear-gradient(135deg,#f97316 0%,#dc2626 100%)',
            '--secondary':        '#fbbf24',
        },
        dark: {
            '--primary':          '#fb923c',
            '--primary-dark':     '#f97316',
            '--primary-light':    'rgba(251,146,60,0.15)',
            '--gradient-primary': 'linear-gradient(135deg,#fb923c 0%,#ef4444 100%)',
            '--secondary':        '#fcd34d',
        }
    },
    ocean: {
        light: {
            '--primary':          '#0284c7',
            '--primary-dark':     '#0369a1',
            '--primary-light':    'rgba(2,132,199,0.1)',
            '--gradient-primary': 'linear-gradient(135deg,#0ea5e9 0%,#0d9488 100%)',
            '--secondary':        '#38bdf8',
        },
        dark: {
            '--primary':          '#38bdf8',
            '--primary-dark':     '#0ea5e9',
            '--primary-light':    'rgba(56,189,248,0.15)',
            '--gradient-primary': 'linear-gradient(135deg,#38bdf8 0%,#2dd4bf 100%)',
            '--secondary':        '#7dd3fc',
        }
    },
    rose: {
        light: {
            '--primary':          '#e11d48',
            '--primary-dark':     '#be123c',
            '--primary-light':    'rgba(225,29,72,0.1)',
            '--gradient-primary': 'linear-gradient(135deg,#f43f5e 0%,#ec4899 100%)',
            '--secondary':        '#fb7185',
        },
        dark: {
            '--primary':          '#fb7185',
            '--primary-dark':     '#f43f5e',
            '--primary-light':    'rgba(251,113,133,0.15)',
            '--gradient-primary': 'linear-gradient(135deg,#fb7185 0%,#f472b6 100%)',
            '--secondary':        '#fda4af',
        }
    },
    forest: {
        light: {
            '--primary':          '#16a34a',
            '--primary-dark':     '#15803d',
            '--primary-light':    'rgba(22,163,74,0.1)',
            '--gradient-primary': 'linear-gradient(135deg,#22c55e 0%,#14b8a6 100%)',
            '--secondary':        '#4ade80',
        },
        dark: {
            '--primary':          '#4ade80',
            '--primary-dark':     '#22c55e',
            '--primary-light':    'rgba(74,222,128,0.15)',
            '--gradient-primary': 'linear-gradient(135deg,#4ade80 0%,#2dd4bf 100%)',
            '--secondary':        '#86efac',
        }
    }
};

function applyTheme(themeName) {
    const isDark = AppState.theme === 'dark';
    const palette = THEMES[themeName] || THEMES.default;
    const vars = isDark ? palette.dark : palette.light;
    const root = document.documentElement;
    const allVars = ['--primary','--primary-dark','--primary-light','--gradient-primary','--secondary'];
    if (themeName === 'default') {
        allVars.forEach(k => root.style.removeProperty(k));
    } else {
        Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    }
    const meta = document.getElementById('themeColorMeta');
    if (meta) meta.content = isDark ? '#1f2937' : '#ffffff';
    document.querySelectorAll('.theme-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.theme === themeName);
    });
    AppState.settings.colorTheme = themeName;
    saveSettings();
}

function setupThemePicker() {
    document.querySelectorAll('.theme-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            haptic(25);
            applyTheme(btn.dataset.theme);
        });
    });
    const saved = AppState.settings.colorTheme || 'default';
    applyTheme(saved);
}

// ============================================
// ACCORDION
// ============================================
let _accordionFloatBar = null;
let _accordionScrollHandler = null;

function removeAccordionFloatBar() {
    if (_accordionFloatBar) { _accordionFloatBar.remove(); _accordionFloatBar = null; }
    if (_accordionScrollHandler) {
        const pane = document.querySelector('.tab-pane.active');
        if (pane) pane.removeEventListener('scroll', _accordionScrollHandler);
        _accordionScrollHandler = null;
    }
}

function addAccordionFloatBar(item, headerBtn) {
    removeAccordionFloatBar();
    const titleEl = headerBtn.querySelector('.accordion-title');
    const iconEl  = headerBtn.querySelector('.accordion-icon-wrap i');
    const title   = titleEl ? titleEl.textContent : 'بستن';
    const iconClass = iconEl ? iconEl.className : 'fas fa-chevron-up';

    const bar = document.createElement('div');
    bar.className = 'accordion-float-bar';
    bar.innerHTML = `
        <div class="accordion-float-left">
            <i class="${iconClass}"></i>
            <span>${title}</span>
        </div>
        <button class="accordion-float-close"><i class="fas fa-times"></i> بستن</button>
    `;
    bar.querySelector('.accordion-float-close').addEventListener('click', () => {
        toggleAccordion(headerBtn);
    });
    document.body.appendChild(bar);
    _accordionFloatBar = bar;

    const pane = document.querySelector('.tab-pane.active') || window;
    _accordionScrollHandler = () => {
        const headerRect = headerBtn.getBoundingClientRect();
        if (headerRect.bottom < 60) {
            bar.classList.add('visible');
        } else {
            bar.classList.remove('visible');
        }
    };
    pane.addEventListener('scroll', _accordionScrollHandler, { passive: true });
}

function toggleAccordion(headerBtn) {
    const item = headerBtn.closest('.accordion-item');
    const body = item.querySelector('.accordion-body');
    const chevron = headerBtn.querySelector('.accordion-chevron');
    const isOpen = item.classList.contains('open');

    document.querySelectorAll('.accordion-item.open').forEach(openItem => {
        if (openItem !== item) {
            openItem.classList.remove('open');
            openItem.querySelector('.accordion-body').style.maxHeight = '0';
            openItem.querySelector('.accordion-body').style.padding = '0';
            openItem.querySelector('.accordion-chevron').style.transform = '';
        }
    });

    if (isOpen) {
        item.classList.remove('open');
        body.style.maxHeight = '0';
        body.style.padding = '0';
        chevron.style.transform = '';
        removeAccordionFloatBar();
        if (history.state && history.state.accordionOpen) history.back();
    } else {
        item.classList.add('open');
        body.style.maxHeight = body.scrollHeight + 2000 + 'px';
        body.style.padding = '0 0 14px';
        chevron.style.transform = 'rotate(180deg)';
        haptic(20);
        addAccordionFloatBar(item, headerBtn);
        history.pushState({ accordionOpen: true }, '');
        setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    }
}

window.addEventListener('popstate', () => {
    const openItem = document.querySelector('.accordion-item.open');
    if (openItem) {
        const hBtn = openItem.querySelector('.accordion-header');
        if (hBtn) {
            openItem.classList.remove('open');
            const body = openItem.querySelector('.accordion-body');
            if (body) { body.style.maxHeight = '0'; body.style.padding = '0'; }
            const chev = hBtn.querySelector('.accordion-chevron');
            if (chev) chev.style.transform = '';
            removeAccordionFloatBar();
        }
    }
});

function refreshAccordion(el) {
    const body = el.closest('.accordion-body');
    if (body && body.closest('.accordion-item.open')) {
        body.style.maxHeight = body.scrollHeight + 2000 + 'px';
    }
}

function toggleAccordionById(bodyId) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const item = body.closest('.accordion-item');
    if (!item) return;
    const chevronIcon = item.querySelector('.qref-chevron i');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.qref-accordion-item.open').forEach(openItem => {
        if (openItem !== item) {
            openItem.classList.remove('open');
            const b = openItem.querySelector('.accordion-body');
            if (b) { b.style.maxHeight = '0'; b.style.padding = '0'; }
            const c = openItem.querySelector('.qref-chevron i');
            if (c) c.style.transform = '';
        }
    });
    if (isOpen) {
        item.classList.remove('open');
        body.style.maxHeight = '0';
        body.style.padding = '0';
        if (chevronIcon) chevronIcon.style.transform = '';
    } else {
        item.classList.add('open');
        body.style.maxHeight = body.scrollHeight + 1000 + 'px';
        body.style.padding = '0 12px 12px';
        if (chevronIcon) chevronIcon.style.transform = 'rotate(180deg)';
        haptic(20);
        setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
    }
}

// ============================================
// GCS CALCULATOR
// ============================================
const GCS_STATE = { eye: null, verbal: null, motor: null };

function setupGCS() {
    document.querySelectorAll('.gcs-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            haptic(25);
            const domain = btn.dataset.domain;
            const score = parseInt(btn.dataset.score);
            btn.closest('.gcs-btn-group').querySelectorAll('.gcs-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            GCS_STATE[domain] = score;
            const scoreMap = { eye: 'eScore', verbal: 'vScore', motor: 'mScore' };
            const scoreEl = document.getElementById(scoreMap[domain]);
            if (scoreEl) scoreEl.textContent = score;
            updateGCS();
        });
    });

    const resetBtn = document.getElementById('gcsResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetGCS);
}

function updateGCS() {
    const { eye, verbal, motor } = GCS_STATE;
    if (eye === null || verbal === null || motor === null) return;

    const total = eye + verbal + motor;
    const totalEl = document.getElementById('gcsTotalScore');
    const formulaEl = document.getElementById('gcsTotalFormula');
    const badgeEl = document.getElementById('gcsSeverityBadge');
    const notesEl = document.getElementById('gcsNotes');
    const boxEl = document.getElementById('gcsResultBox');

    if (totalEl) totalEl.textContent = total;
    if (formulaEl) formulaEl.textContent = `E${eye} + V${verbal} + M${motor}`;

    let severity, badgeClass, notes;

    if (total >= 13) {
        severity = 'خفیف';
        badgeClass = 'gcs-badge-mild';
        notes = [
            'سطح هوشیاری خوب — بیمار پاسخ‌دهی مناسب دارد',
            'پایش مداوم علائم حیاتی توصیه می‌شود',
            'در صورت کاهش GCS بلافاصله گزارش دهید'
        ];
    } else if (total >= 9) {
        severity = 'متوسط';
        badgeClass = 'gcs-badge-moderate';
        notes = [
            'اختلال هوشیاری متوسط — نیاز به مراقبت ویژه دارد',
            'پایش مداوم راه هوایی ضروری است',
            'خطر آسپیراسیون وجود دارد — وضعیت بیمار را مدیریت کنید',
            'بررسی مکرر GCS هر ۱ تا ۲ ساعت'
        ];
    } else {
        severity = 'شدید — کُما';
        badgeClass = 'gcs-badge-severe';
        notes = [
            '⚠️ GCS ≤ ۸: آستانه اینتوباسیون — راه هوایی را ایمن کنید',
            'خطر بالای آسپیراسیون و انسداد راه هوایی',
            'بیمار نیاز به ICU و مراقبت‌های ویژه دارد',
            'پزشک را فوری مطلع کنید',
            'پایش ICP در صورت آسیب مغزی توصیه می‌شود'
        ];
    }

    if (badgeEl) {
        badgeEl.textContent = `شدت: ${severity}`;
        badgeEl.className = `gcs-severity-badge ${badgeClass}`;
    }

    if (notesEl) {
        notesEl.innerHTML = notes.map(n => `<div class="gcs-note-item"><i class="fas fa-circle-info"></i><span>${n}</span></div>`).join('');
    }

    if (boxEl) {
        boxEl.style.display = 'block';
        refreshAccordion(boxEl);
        setTimeout(() => boxEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
    }
    haptic(40);
}

function resetGCS() {
    GCS_STATE.eye = null;
    GCS_STATE.verbal = null;
    GCS_STATE.motor = null;
    document.querySelectorAll('.gcs-btn').forEach(b => b.classList.remove('active'));
    ['eScore','vScore','mScore'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
    });
    const box = document.getElementById('gcsResultBox');
    if (box) box.style.display = 'none';
    haptic(30);
}

// ============================================
// BURNS / TBSA CALCULATOR
// ============================================

const BURNS_ADULT = {
    head: 4.5, head_b: 4.5,
    neck: 1,
    chest: 9, abdomen: 9,
    upper_back: 9, lower_back: 9,
    perineum: 1,
    buttocks: 2.5,
    l_upper_arm: 2, r_upper_arm: 2,
    l_upper_arm_b: 2, r_upper_arm_b: 2,
    l_lower_arm: 1.5, r_lower_arm: 1.5,
    l_lower_arm_b: 1.5, r_lower_arm_b: 1.5,
    l_hand: 1.25, r_hand: 1.25,
    l_thigh_f: 4.75, r_thigh_f: 4.75,
    l_thigh_b: 4.75, r_thigh_b: 4.75,
    l_leg_f: 3.5, r_leg_f: 3.5,
    l_leg_b: 3.5, r_leg_b: 3.5,
    l_foot: 1.75, r_foot: 1.75
};

const BURNS_PEDIATRIC = {
    head: 9.5, head_b: 9.5,
    neck: 1,
    chest: 9, abdomen: 9,
    upper_back: 9, lower_back: 9,
    perineum: 1,
    buttocks: 2.5,
    l_upper_arm: 2, r_upper_arm: 2,
    l_upper_arm_b: 2, r_upper_arm_b: 2,
    l_lower_arm: 1.5, r_lower_arm: 1.5,
    l_lower_arm_b: 1.5, r_lower_arm_b: 1.5,
    l_hand: 1.25, r_hand: 1.25,
    l_thigh_f: 3.25, r_thigh_f: 3.25,
    l_thigh_b: 3.25, r_thigh_b: 3.25,
    l_leg_f: 2.75, r_leg_f: 2.75,
    l_leg_b: 2.75, r_leg_b: 2.75,
    l_foot: 1.75, r_foot: 1.75
};

const BURNS_STATE = { selected: new Set(), ageMode: 'adult' };

function setupBurns() {
    document.querySelectorAll('.burns-region').forEach(region => {
        region.addEventListener('click', () => {
            haptic(20);
            const key = region.dataset.region;
            if (BURNS_STATE.selected.has(key)) {
                BURNS_STATE.selected.delete(key);
                document.querySelectorAll(`[data-region="${key}"]`).forEach(el => el.classList.remove('selected'));
            } else {
                BURNS_STATE.selected.add(key);
                document.querySelectorAll(`[data-region="${key}"]`).forEach(el => el.classList.add('selected'));
            }
            updateBurns();
        });
    });
}

function setBurnsAge(mode) {
    BURNS_STATE.ageMode = mode;
    const adultBtn = document.getElementById('burnsAdultBtn');
    const pedBtn = document.getElementById('burnsPedBtn');
    const noteEl = document.getElementById('burnsRuleNote');
    if (adultBtn) adultBtn.classList.toggle('active', mode === 'adult');
    if (pedBtn) pedBtn.classList.toggle('active', mode === 'pediatric');
    if (noteEl) noteEl.textContent = mode === 'adult' ? 'قانون نُه — بزرگسال' : 'Lund-Browder — کودک (تقریبی)';
    updateBurns();
    haptic(25);
}

function updateBurns() {
    const table = BURNS_STATE.ageMode === 'adult' ? BURNS_ADULT : BURNS_PEDIATRIC;
    let total = 0;
    BURNS_STATE.selected.forEach(key => { total += (table[key] || 0); });
    total = Math.min(total, 100);

    const tbsaEl = document.getElementById('burnsTBSA');
    const resultBox = document.getElementById('burnsResultBox');
    const chipsEl = document.getElementById('burnsChips');
    const notesEl = document.getElementById('burnsNotes');

    if (chipsEl) {
        if (BURNS_STATE.selected.size === 0) {
            chipsEl.innerHTML = '<span class="burns-chips-placeholder">هیچ ناحیه‌ای انتخاب نشده</span>';
        } else {
            const labels = [];
            BURNS_STATE.selected.forEach(key => {
                const el = document.querySelector(`[data-region="${key}"]`);
                if (el) labels.push(el.dataset.label);
            });
            chipsEl.innerHTML = labels.map(l => `<span class="burns-chip">${l}</span>`).join('');
        }
    }

    if (BURNS_STATE.selected.size === 0) {
        if (resultBox) resultBox.style.display = 'none';
        refreshAccordion(chipsEl || document.getElementById('burnsChips'));
        return;
    }

    if (tbsaEl) tbsaEl.textContent = total.toFixed(1) + '%';

    let notes = [];
    if (total < 10) {
        notes = ['سوختگی محدود — مراقبت سرپایی ممکن است کافی باشد', 'درصورت درگیری صورت، دست یا پرینه: ارجاع به مرکز سوختگی'];
    } else if (total < 20) {
        notes = ['سوختگی متوسط — بستری ضروری است', 'احیاء مایع را شروع کنید (فرمول Parkland)', 'پایش ادرار ساعتی توصیه می‌شود (۰.۵ cc/kg/hr)'];
    } else if (total < 40) {
        notes = ['⚠️ سوختگی وسیع — ICU ضروری است', 'فوری فرمول Parkland را شروع کنید', '۵۰٪ مایع اول ۸ ساعت، ۵۰٪ باقی ۱۶ ساعت', 'ارجاع فوری به مرکز تخصصی سوختگی'];
    } else {
        notes = ['🚨 سوختگی حیاتی — خطر جدی برای بیمار', 'انتقال فوری به مرکز تخصصی سوختگی', 'احیاء مایع تهاجمی فوری', 'پایش راه هوایی — احتمال سوختگی استنشاقی را بررسی کنید'];
    }

    if (notesEl) {
        notesEl.innerHTML = notes.map(n => `<div class="burns-note-item"><i class="fas fa-circle-info"></i><span>${n}</span></div>`).join('');
    }

    if (resultBox) {
        resultBox.style.display = 'block';
        refreshAccordion(resultBox);
    }

    updateParkland();
}

function updateParkland() {
    const weightEl = document.getElementById('burnsWeight');
    const parklandEl = document.getElementById('parklandResult');
    const parklandRow = document.getElementById('parklandRow');
    if (!weightEl || !parklandEl || !parklandRow) return;

    const weight = parseFloat(weightEl.value);
    const table = BURNS_STATE.ageMode === 'adult' ? BURNS_ADULT : BURNS_PEDIATRIC;
    let total = 0;
    BURNS_STATE.selected.forEach(key => { total += (table[key] || 0); });
    total = Math.min(total, 100);

    if (!weight || weight <= 0 || BURNS_STATE.selected.size === 0) {
        parklandRow.style.display = 'none';
        return;
    }

    const totalFluid = 4 * weight * total;
    const first8h = totalFluid / 2;
    const next16h = totalFluid / 2;
    parklandEl.innerHTML = '<span dir="ltr" style="display:inline-block; unicode-bidi:isolate;">' + totalFluid.toFixed(0) + ' mL</span>';
    parklandRow.querySelector('.burns-result-label').innerHTML = 'Parkland: <span dir="ltr" style="display:inline-block; unicode-bidi:isolate;">' + totalFluid.toFixed(0) + ' mL</span> (اول ۸ ساعت: <span dir="ltr">' + first8h.toFixed(0) + ' mL</span> | ۱۶ ساعت باقی: <span dir="ltr">' + next16h.toFixed(0) + ' mL</span>)';
    parklandRow.style.display = 'flex';
}

function resetBurns() {
    BURNS_STATE.selected.clear();
    document.querySelectorAll('.burns-region').forEach(el => el.classList.remove('selected'));
    const chipsEl = document.getElementById('burnsChips');
    if (chipsEl) chipsEl.innerHTML = '<span class="burns-chips-placeholder">هیچ ناحیه‌ای انتخاب نشده</span>';
    const resultBox = document.getElementById('burnsResultBox');
    if (resultBox) resultBox.style.display = 'none';
    const weightEl = document.getElementById('burnsWeight');
    if (weightEl) weightEl.value = '';
    haptic(30);
}

// ============================================
// GLOBALS
// ============================================
window.selectDrug = selectDrug;
window.switchTab = switchTab;
window.calculateManualInfusion = calculateManualInfusion;
window.convertElectrolyte = convertElectrolyte;
window.convertElectrolyteLive = convertElectrolyteLive;
window.convertUnitsLive = convertUnitsLive;
window.convertPercentageLive = convertPercentageLive;
window.calculateDripRateLive = calculateDripRateLive;
window.convertTempLive = convertTempLive;
window.convertWeightLive = convertWeightLive;
window.convertPercentage = convertPercentage;
window.convertUnits = convertUnits;
window.calculateDripRate = calculateDripRate;
window.calculateBMI = calculateBMI;
window.calculateBSA = calculateBSA;
window.calculateIBW = calculateIBW;
window.calculateCrCl = calculateCrCl;
window.checkCompatibility = checkCompatibility;
window.calculateDose = calculateDose;
window.TextDirection = TextDirection;
window.PersianNumbers = PersianNumbers;
window.exportHistory = exportHistory;
window.toggleAccordion = toggleAccordion;
window.applyTheme = applyTheme;
window.showUpdateBanner = showUpdateBanner;
window.toggleAccordionById = toggleAccordionById;
window.setBurnsAge = setBurnsAge;
window.resetBurns = resetBurns;
window.updateParkland = updateParkland;
window.restoreFromHistory = restoreFromHistory;
window.updateDoseRangeIndicator = updateDoseRangeIndicator;

// ============================================
// USER NAME & GREETING BANNER
// ============================================
function getGreeting() {
    const h   = new Date().getHours();
    const raw = (localStorage.getItem('userName') || '').trim();
    const n   = raw ? '\u2066' + raw + '\u2069' : '';
    const app = '\u2066FoxiMed\u2069';

    const morning = n ? [
        `صبح بخیر ${n} عزیز 🌅`,
        `سلام ${n}! امیدوارم شیفت امروز آروم باشه ☀️`,
        `صبح بخیر ${n} — ${app} در خدمت شماست 🌤️`,
        `${n} عزیز، صبح بخیر 🌸 آماده‌ی یه شیفت خوب هستیم`,
        `خوش اومدی ${n} 🌅 از اینکه تو کارت بهت کمک کنم خوشحال میشم`,
        `سلام ${n}! روزت بخیر ☀️ بریم شروع کنیم`,
        `${n} عزیز، ما با هم ترکیب خیلی خوبی هستیم 🌅`,
    ] : [
        `صبح بخیر! روز پرانرژی‌ای داشته باشید 🌅`,
        `صبح بخیر 🌤️ — ${app} در خدمت شماست`,
        `سلام! امیدوارم شیفت امروز آروم باشه ☀️`,
        `صبح بخیر! از اینکه تو کارتون بهتون کمک کنم خوشحال میشم 🌸`,
        `خوش اومدید 🌅 ${app} آماده‌ی محاسبه‌ست`,
        `سلام! ما با هم ترکیب خیلی خوبی هستیم ☀️`,
        `صبح بخیر! هرموقع کمک بخواید اینجام 🌤️`,
    ];

    const afternoon = n ? [
        `روزت بخیر ${n}! وسط شیفت همه چیز خوبه؟ 🌞`,
        `سلام ${n}! بعدازظهر بخیر 💊`,
        `${n} عزیز، روزت بخیر — بریم حساب کنیم 🌞`,
        `سلام ${n}! هرموقع کمک بخوای اینجام 💉`,
        `روزت بخیر ${n}! ${app} کنارتونه 🌞`,
        `${n} عزیز، از اینکه تو کارت بهت کمک کنم خیلی خوشحال میشم 🌞`,
    ] : [
        `ظهر بخیر! ${app} آماده محاسبه است 🌞`,
        `روزتون بخیر! مراقب خودتون باشید 💊`,
        `سلام! هرموقع کمک بخواید اینجام 🌞`,
        `روزتون بخیر! ${app} کنارتونه 💉`,
        `سلام! از اینکه تو کارتون بهتون کمک کنم خوشحال میشم 🌞`,
        `ظهر بخیر! ما با هم ترکیب خیلی خوبی هستیم 🌞`,
    ];

    const evening = n ? [
        `عصر بخیر ${n}! شیفت عصر رو با آرامش طی کنید 🌆`,
        `سلام ${n}! عصر بخیر 🌇`,
        `${n} عزیز، عصر بخیر — ${app} اینجاست 🌆`,
        `عصر بخیر ${n}! هرموقع کمک بخوای اینجام ☕`,
        `سلام ${n}! از اینکه تو کارت بهت کمک کنم خیلی خوشحال میشم 🌇`,
        `${n} عزیز، ما با هم ترکیب خیلی خوبی هستیم 🌆`,
    ] : [
        `عصر بخیر! شیفت عصر رو با آرامش طی کنید 🌆`,
        `عصر بخیر! ${app} همراه شماست 🌇`,
        `سلام! هرموقع کمک بخواید اینجام ☕`,
        `عصر بخیر! از اینکه تو کارتون بهتون کمک کنم خوشحال میشم 🌆`,
        `سلام! ما با هم ترکیب خیلی خوبی هستیم 🌇`,
        `عصر بخیر! ${app} آماده‌ست 🌆`,
    ];

    const night = n ? [
        `شب بخیر ${n} 🌙 شیفت شب رو با موفقیت پشت سر بذارید`,
        `سلام ${n}! مواظب خودتون باشید در شیفت شب ⭐`,
        `${n} عزیز، شب بخیر 🌙 — ${app} همیشه بیداره`,
        `شب بخیر ${n}! شیفت شب سنگینه ولی شما از پسش برمیاین 💫`,
        `سلام ${n}! هرموقع کمک بخوای اینجام 🌙`,
        `${n} عزیز، از اینکه تو کارت بهت کمک کنم خیلی خوشحال میشم ⭐`,
        `شب بخیر ${n}! ما با هم ترکیب خیلی خوبی هستیم 🌙`,
        `${n} عزیز، مراقب خودت باش ⭐ ${app} کنارته`,
    ] : [
        `شب بخیر 🌙 شیفت شب رو با موفقیت پشت سر بذارید`,
        `شب بخیر! مواظب خودتون باشید ⭐`,
        `${app} همیشه بیداره 🌙 — شب بخیر`,
        `شب بخیر! شیفت شب سنگینه ولی شما از پسش برمیاین 💫`,
        `سلام! هرموقع کمک بخواید اینجام 🌙`,
        `شب بخیر! از اینکه تو کارتون بهتون کمک کنم خوشحال میشم ⭐`,
        `شب بخیر! ما با هم ترکیب خیلی خوبی هستیم 🌙`,
    ];

    let pool;
    if      (h >= 5  && h < 12) pool = morning;
    else if (h >= 12 && h < 17) pool = afternoon;
    else if (h >= 17 && h < 21) pool = evening;
    else                         pool = night;

    return pool[Math.floor(Math.random() * pool.length)];
}


function showGreetingBanner() {
    const banner = document.getElementById('greetingBanner');
    const textEl = document.getElementById('greetingText');
    const closeBtn = document.getElementById('greetingClose');
    if (!banner || !textEl) return;

    textEl.textContent = getGreeting();

    banner.style.display = 'flex';
    banner.classList.remove('banner-hiding');
    banner.classList.add('banner-visible');

    let autoDismiss = setTimeout(dismissBanner, 4500);

    function dismissBanner() {
        clearTimeout(autoDismiss);
        banner.classList.add('banner-hiding');
        banner.addEventListener('animationend', () => { banner.style.display = 'none'; }, { once: true });
    }

    closeBtn.addEventListener('click', dismissBanner);
}

function setupUserName() {
    const input   = document.getElementById('userNameInput');
    const saveBtn = document.getElementById('userNameSaveBtn');
    const hint    = document.getElementById('userNameHint');
    if (!input || !saveBtn) return;

    let storedName = localStorage.getItem('userName') || '';

    function updateButtonState() {
        const currentValue = input.value.trim();
        const isValid = currentValue !== '' && currentValue !== storedName;
        if (isValid) {
            saveBtn.classList.add('active');
        } else {
            saveBtn.classList.remove('active');
        }
    }

    function saveName() {
        if (!saveBtn.classList.contains('active')) return;
        const newName = input.value.trim();
        localStorage.setItem('userName', newName);
        storedName = newName;
        if (hint) {
            hint.textContent = newName ? `نام ذخیره شد: ${newName}` : 'نامی ذخیره نشده';
            hint.classList.add('hint-saved');
            setTimeout(() => {
                hint.textContent = 'برای ذخیره Enter بزنید یا روی ✓ کلیک کنید';
                hint.classList.remove('hint-saved');
            }, 2000);
        }
        updateButtonState();
    }

    input.value = storedName;
    updateButtonState();

    input.addEventListener('input', updateButtonState);
    saveBtn.addEventListener('click', saveName);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (saveBtn.classList.contains('active')) {
                saveName();
                input.blur();
            }
        }
    });
}

// ============================================
// CONTEXTUAL HELP POPOVERS
// ============================================
const HELP_TEXTS = {
    method: 'روش تزریق دارو را مشخص می‌کند.\n«پمپ سرنگ» برای حجم‌های کم (۱۰–۵۰ سی‌سی) و «پمپ انفوزیون» برای حجم‌های بیشتر (۱۰۰–۱۰۰۰ سی‌سی) استفاده می‌شود. انتخاب روش، گزینه‌های حجم را تغییر می‌دهد.',
    volume: 'حجم کل محلولی که دارو در آن حل می‌شود را وارد کنید (سی‌سی).\nمثلاً اگر ۵۰ سی‌سی انتخاب کنید، دارو در ۵۰ سی‌سی سرم حل شده و غلظت و سرعت پمپ بر این اساس محاسبه می‌شود.',
    ampoule: 'تعداد آمپول یا ویال دارویی که به محلول اضافه می‌کنید را مشخص کنید.\nبرای انسولین و برخی داروها می‌توانید مقدار دقیق واحد یا میلی‌گرم اضافه‌شده را مستقیماً وارد کنید.',
    dose: 'دوز درخواستی پزشک را اینجا وارد کنید.\nواحد دوز بسته به دارو متفاوت است (مثلاً واحد/ساعت، میکروگرم/کیلوگرم/دقیقه). پس از وارد کردن دوز، دکمه محاسبه را بزنید.',
    weight: 'وقتی این گزینه فعال است، دوز بر اساس وزن بیمار محاسبه می‌شود.\nمثلاً اگر دوز ۰.۱ واحد/کیلوگرم/ساعت باشد و وزن بیمار ۷۰ کیلوگرم، دوز کل ۷ واحد/ساعت خواهد بود.',
    reverse: 'با فعال کردن این گزینه، به جای وارد کردن دوز، سرعت پمپ (سی‌سی/ساعت) را وارد می‌کنید و دوز دریافتی بیمار محاسبه می‌شود.',
    ysite: 'Y-Site به نقطه‌ای در ست سرم گفته می‌شود که دو دارو از دو خط مختلف به یک ورید تزریق می‌شوند.\nسازگاری Y-Site یعنی آیا این دو دارو می‌توانند همزمان از یک ورید تزریق شوند بدون اینکه واکنش شیمیایی داشته باشند یا رسوب تشکیل دهند.\n⚠️ همیشه با داروساز مشورت کنید.',
};

function setupHelpPopovers() {
    const popover = document.getElementById('helpPopover');
    const popoverText = document.getElementById('helpPopoverText');
    if (!popover || !popoverText) return;

    let activeBtn = null;

    function showPopover(btn) {
        const key = btn.dataset.help;
        const text = HELP_TEXTS[key];
        if (!text) return;
        popoverText.innerHTML = text.replace(/\n/g, '<br>');
        popover.style.display = 'block';
        const btnRect = btn.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        const scrollY = window.scrollY || 0;
        let top = btnRect.bottom + scrollY + 8;
        let left = btnRect.left - popRect.width / 2 + btnRect.width / 2;
        const margin = 12;
        left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
        popover.style.top = top + 'px';
        popover.style.left = left + 'px';
        const arrowLeft = (btnRect.left + btnRect.width / 2) - left;
        popover.querySelector('.help-popover-arrow').style.right = 'auto';
        popover.querySelector('.help-popover-arrow').style.left = Math.max(12, arrowLeft) + 'px';
        activeBtn = btn;
        btn.classList.add('active');
    }

    function hidePopover() {
        popover.style.display = 'none';
        if (activeBtn) { activeBtn.classList.remove('active'); activeBtn = null; }
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.help-icon');
        if (btn) {
            e.stopPropagation();
            if (activeBtn === btn) { hidePopover(); return; }
            showPopover(btn);
            return;
        }
        if (!popover.contains(e.target)) hidePopover();
    });

    document.addEventListener('scroll', hidePopover, { passive: true });
    window.addEventListener('resize', hidePopover, { passive: true });
}

// ============================================
// RASS — Richmond Agitation-Sedation Scale
// ============================================
function setupRASS() {
    const levels = document.querySelectorAll('#rassAccordionBody .rass-level');
    levels.forEach(level => {
        level.addEventListener('click', () => {
            haptic(25);
            levels.forEach(l => l.classList.remove('selected'));
            level.classList.add('selected');
            const score = parseInt(level.dataset.score);
            updateRASS(score);
        });
    });
    const resetBtn = document.getElementById('rassResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetRASS);
}

function updateRASS(score) {
    const box = document.getElementById('rassResultBox');
    const scoreEl = document.getElementById('rassResultScore');
    const labelEl = document.getElementById('rassResultLabel');
    const noteEl = document.getElementById('rassResultNote');

    const data = {
        4:  { label: 'خشونت آشکار', color: '#ef4444', note: '⚠️ نیاز فوری به مداخله — خطر برای کادر درمان. داروی آرام‌بخش سریع الاثر تجویز شود.' },
        3:  { label: 'بسیار آژیته', color: '#f97316', note: '⚠️ ارزیابی علت آژیتاسیون (درد، هیپوکسی، دلیریوم). مداخله دارویی احتمالاً لازم است.' },
        2:  { label: 'آژیته', color: '#f97316', note: 'بررسی علل قابل درمان (درد، احتباس ادراری). تنظیم دوز آرام‌بخش را در نظر بگیرید.' },
        1:  { label: 'بی‌قرار', color: '#fbbf24', note: 'پایش مداوم. بررسی علل محیطی نگرانی بیمار.' },
        0:  { label: 'هوشیار و آرام', color: '#22c55e', note: '✓ سطح هدف آرام‌بخشی در ICU. ادامه پایش.' },
        '-1': { label: 'خواب‌آلود', color: '#0ea5e9', note: 'در مرز قابل قبول. پایش پاسخ به صدا.' },
        '-2': { label: 'سداسیون خفیف', color: '#6366f1', note: 'هدف قابل قبول برای بیماران تحت ونتیلاتور. بررسی روزانه برای کاهش دوز.' },
        '-3': { label: 'سداسیون متوسط', color: '#8b5cf6', note: 'بررسی نیاز بالینی. در صورت امکان کاهش دوز را در نظر بگیرید.' },
        '-4': { label: 'سداسیون عمیق', color: '#a855f7', note: '⚠️ فقط در موارد خاص (ICP بالا، برونکواسپاسم شدید). بررسی روزانه ضروری است.' },
        '-5': { label: 'بی‌هوشی', color: '#7c3aed', note: '⚠️ سداسیون بسیار عمیق. ارزیابی ضروری بودن این سطح. خطر عوارض بالا است.' },
    };

    const key = score.toString();
    const d = data[key];
    if (!d) return;

    if (scoreEl) {
        scoreEl.textContent = score > 0 ? `+${score}` : score;
        scoreEl.style.color = d.color;
    }
    if (labelEl) labelEl.textContent = d.label;
    if (noteEl) noteEl.textContent = d.note;
    if (box) {
        box.style.display = 'block';
        box.style.borderColor = d.color + '40';
        refreshAccordion(box);
        setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
    }
    haptic(40);
}

function resetRASS() {
    document.querySelectorAll('#rassAccordionBody .rass-level').forEach(l => l.classList.remove('selected'));
    const box = document.getElementById('rassResultBox');
    if (box) box.style.display = 'none';
    haptic(30);
}

// ============================================
// BRADEN SCALE
// ============================================
const BRADEN_STATE = { sensory: null, moisture: null, activity: null, mobility: null, nutrition: null, friction: null };
const BRADEN_SCORE_IDS = {
    sensory: 'bradenSensoryScore', moisture: 'bradenMoistureScore',
    activity: 'bradenActivityScore', mobility: 'bradenMobilityScore',
    nutrition: 'bradenNutritionScore', friction: 'bradenFrictionScore'
};

function setupBraden() {
    document.querySelectorAll('#bradenAccordionBody .gcs-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            haptic(25);
            const domain = btn.dataset.braden;
            const score = parseInt(btn.dataset.score);
            btn.closest('.gcs-btn-group').querySelectorAll('.gcs-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            BRADEN_STATE[domain] = score;
            const el = document.getElementById(BRADEN_SCORE_IDS[domain]);
            if (el) el.textContent = score;
            updateBraden();
        });
    });
    const resetBtn = document.getElementById('bradenResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetBraden);
}

function updateBraden() {
    const vals = Object.values(BRADEN_STATE);
    if (vals.some(v => v === null)) return;
    const total = vals.reduce((a, b) => a + b, 0);

    const totalEl = document.getElementById('bradenTotalScore');
    const badgeEl = document.getElementById('bradenSeverityBadge');
    const notesEl = document.getElementById('bradenNotes');
    const box = document.getElementById('bradenResultBox');

    if (totalEl) totalEl.textContent = total;

    let severity, badgeClass, notes;
    if (total >= 19) {
        severity = 'ریسک ندارد';
        badgeClass = 'gcs-badge-mild';
        notes = ['پوست سالم است.', 'آموزش پیشگیری به بیمار و خانواده توصیه می‌شود.'];
    } else if (total >= 15) {
        severity = 'ریسک خفیف';
        badgeClass = 'gcs-badge-mild';
        notes = ['تغییر وضعیت هر ۲ ساعت.', 'مراقبت از پوست و تغذیه مناسب.'];
    } else if (total >= 13) {
        severity = 'ریسک متوسط';
        badgeClass = 'gcs-badge-moderate';
        notes = ['تغییر وضعیت هر ۱–۲ ساعت.', 'استفاده از تشک فشارزدا توصیه می‌شود.', 'ارزیابی روزانه پوست.'];
    } else if (total >= 10) {
        severity = 'ریسک بالا';
        badgeClass = 'gcs-badge-severe';
        notes = ['⚠️ ریسک بالای زخم فشاری.', 'تغییر وضعیت هر ۱ ساعت.', 'تشک تخصصی پیشگیری از زخم ضروری است.', 'بررسی و مستندسازی وضعیت پوست در هر شیفت.'];
    } else {
        severity = 'ریسک بسیار بالا';
        badgeClass = 'gcs-badge-severe';
        notes = ['🚨 ریسک بسیار بالا.', 'پروتکل پیشگیری فشرده فعال شود.', 'تشک تخصصی + تغییر وضعیت هر ۱ ساعت.', 'مشاوره تیم زخم و پوست.', 'بررسی تغذیه و هیدراسیون فوری.'];
    }

    if (badgeEl) { badgeEl.textContent = `خطر: ${severity}`; badgeEl.className = `gcs-severity-badge ${badgeClass}`; }
    if (notesEl) notesEl.innerHTML = notes.map(n => `<div class="gcs-note-item"><i class="fas fa-circle-info"></i><span>${n}</span></div>`).join('');
    if (box) { box.style.display = 'block'; refreshAccordion(box); setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150); }
    haptic(40);
}

function resetBraden() {
    Object.keys(BRADEN_STATE).forEach(k => BRADEN_STATE[k] = null);
    document.querySelectorAll('#bradenAccordionBody .gcs-btn').forEach(b => b.classList.remove('active'));
    Object.values(BRADEN_SCORE_IDS).forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
    const box = document.getElementById('bradenResultBox');
    if (box) box.style.display = 'none';
    haptic(30);
}

// ============================================
// MORSE FALL SCALE
// ============================================
const MORSE_STATE = { fallHistory: null, secDiag: null, aid: null, iv: null, gait: null, mental: null };
const MORSE_SCORE_IDS = {
    fallHistory: 'morseFallHistoryScore', secDiag: 'morseSecDiagScore',
    aid: 'morseAidScore', iv: 'morseIVScore', gait: 'morseGaitScore', mental: 'morseMentalScore'
};

function setupMorse() {
    document.querySelectorAll('#morseAccordionBody .gcs-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            haptic(25);
            const domain = btn.dataset.morse;
            const score = parseInt(btn.dataset.score);
            btn.closest('.gcs-btn-group').querySelectorAll('.gcs-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            MORSE_STATE[domain] = score;
            const el = document.getElementById(MORSE_SCORE_IDS[domain]);
            if (el) el.textContent = score;
            updateMorse();
        });
    });
    const resetBtn = document.getElementById('morseResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetMorse);
}

function updateMorse() {
    const vals = Object.values(MORSE_STATE);
    if (vals.some(v => v === null)) return;
    const total = vals.reduce((a, b) => a + b, 0);

    const totalEl = document.getElementById('morseTotalScore');
    const badgeEl = document.getElementById('morseSeverityBadge');
    const notesEl = document.getElementById('morseNotes');
    const box = document.getElementById('morseResultBox');

    if (totalEl) totalEl.textContent = total;

    let severity, badgeClass, notes;
    if (total < 25) {
        severity = 'ریسک کم';
        badgeClass = 'gcs-badge-mild';
        notes = ['ریسک سقوط پایین.', 'مراقبت استاندارد ایمنی کافی است.'];
    } else if (total <= 50) {
        severity = 'ریسک متوسط';
        badgeClass = 'gcs-badge-moderate';
        notes = ['⚠️ ریسک متوسط سقوط.', 'پروتکل پیشگیری از سقوط فعال شود.', 'آموزش به بیمار و خانواده.', 'نرده تخت بالا باشد.'];
    } else {
        severity = 'ریسک بالا';
        badgeClass = 'gcs-badge-severe';
        notes = ['🚨 ریسک بالای سقوط.', 'پروتکل پیشگیری فشرده فعال شود.', 'نظارت مداوم یا ناظر بالینی.', 'دستبند قرمز ریسک سقوط نصب شود.', 'محیط بیمار ایمن‌سازی شود (کفپوش، نور کافی).', 'مرور داروهای موثر بر تعادل (آرام‌بخش، ادرارآور).'];
    }

    if (badgeEl) { badgeEl.textContent = `خطر: ${severity}`; badgeEl.className = `gcs-severity-badge ${badgeClass}`; }
    if (notesEl) notesEl.innerHTML = notes.map(n => `<div class="gcs-note-item"><i class="fas fa-circle-info"></i><span>${n}</span></div>`).join('');
    if (box) { box.style.display = 'block'; refreshAccordion(box); setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150); }
    haptic(40);
}

function resetMorse() {
    Object.keys(MORSE_STATE).forEach(k => MORSE_STATE[k] = null);
    document.querySelectorAll('#morseAccordionBody .gcs-btn').forEach(b => b.classList.remove('active'));
    Object.values(MORSE_SCORE_IDS).forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
    const box = document.getElementById('morseResultBox');
    if (box) box.style.display = 'none';
    haptic(30);
}

// ============================================
// OXYGEN CYLINDER CALCULATOR
// ============================================
function setupOxygenCalculator() {
    const presets = document.querySelectorAll('#oxySizePresets .volume-preset-btn');
    const sizeInput = document.getElementById('oxyCylinderSize');
    presets.forEach(btn => {
        btn.addEventListener('click', function() {
            presets.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            if (sizeInput) {
                sizeInput.value = this.dataset.oxysize;
                sizeInput.dataset.numericValue = this.dataset.oxysize;
            }
            fixVolumeButtonColors();
        });
    });
    ['oxyCylinderSize','oxyPressure','oxyFlow'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function() {
            const normalized = PersianNumbers.toLatin(this.value);
            if (normalized !== this.value) this.value = normalized;
        });
    });
    if (sizeInput) sizeInput.value = '5';
}

window.calculateOxygen = function() {
    const cylinderSize = PersianNumbers.parseNumber(document.getElementById('oxyCylinderSize')?.value);
    const pressure     = PersianNumbers.parseNumber(document.getElementById('oxyPressure')?.value);
    const flow         = PersianNumbers.parseNumber(document.getElementById('oxyFlow')?.value);
    const resultBox    = document.getElementById('oxyResult');

    if (!cylinderSize || isNaN(cylinderSize) || cylinderSize <= 0) { showToast('خطا', 'حجم کپسول را وارد کنید', 'error'); return; }
    if (!pressure     || isNaN(pressure)     || pressure <= 0)     { showToast('خطا', 'فشار کپسول را وارد کنید', 'error'); return; }
    if (!flow         || isNaN(flow)         || flow <= 0)         { showToast('خطا', 'جریان اکسیژن را وارد کنید', 'error'); return; }

    const totalVolume = cylinderSize * pressure;
    const usableVolume = totalVolume * 0.9;
    const durationMinutes = usableVolume / flow;
    const hours = Math.floor(durationMinutes / 60);
    const minutes = Math.round(durationMinutes % 60);

    const durationEl = document.getElementById('oxyDuration');
    const totalVolEl = document.getElementById('oxyTotalVol');

    if (durationEl) {
        if (hours > 0) {
            durationEl.textContent = `${hours} ساعت و ${minutes} دقیقه`;
        } else {
            durationEl.textContent = `${minutes} دقیقه`;
        }
    }
    if (totalVolEl) totalVolEl.textContent = totalVolume.toFixed(0);
    if (resultBox) resultBox.style.display = 'block';
    haptic(40);
    setTimeout(() => resultBox?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
};

// ============================================
// Y-SITE COMPATIBILITY MATRIX
// ============================================

// Comprehensive bidirectional compatibility matrix
// Status: 'y' = compatible, 'n' = incompatible, '?' = unknown/caution
// Based on standard ICU pharmacy references (Micromedex, King Guide, Trissel's)
const YSITE_MATRIX = {
    // 'y' = Compatible (well-established Y-site data)
    // 'n' = Incompatible (precipitation/physical incompatibility confirmed)
    // 'v' = Verify locally (conflicting or limited evidence)
    // '?' = No reliable Y-site data found

    // ── AMIODARONE ──
    'amiodarone|dobutamine':'y', 'amiodarone|dopamine':'y', 'amiodarone|fentanyl':'y',
    'amiodarone|heparin':'v',    // conflicting data — some formulations incompatible
    'amiodarone|insulin':'?', 'amiodarone|labetalol':'?',
    'amiodarone|lasix':'n', 'amiodarone|lidocaine':'y', 'amiodarone|midazolam':'y',
    'amiodarone|norepinephrine':'y', 'amiodarone|octreotide':'?',
    'amiodarone|pantoprazole':'n', 'amiodarone|tng':'y',
    'amiodarone|morphine':'y', 'amiodarone|propofol':'y',
    'amiodarone|vancomycin':'?', 'amiodarone|piperacillin':'n',
    'amiodarone|ceftriaxone':'?', 'amiodarone|meropenem':'?',
    'amiodarone|potassium':'y', 'amiodarone|magnesium':'y',
    'amiodarone|dexamethasone':'?', 'amiodarone|hydrocortisone':'?',
    'amiodarone|ranitidine':'y', 'amiodarone|phenytoin':'n',
    'amiodarone|sodium_bicarb':'n', 'amiodarone|atropine':'?',
    'amiodarone|cefazolin':'?', 'amiodarone|ceftazidime':'?',
    'amiodarone|acetaminophen':'?', 'amiodarone|levetiracetam':'?',
    'amiodarone|dobutamine':'y',

    // ── DOBUTAMINE ──
    'dobutamine|dopamine':'y', 'dobutamine|fentanyl':'y', 'dobutamine|heparin':'y',
    'dobutamine|insulin':'?', 'dobutamine|labetalol':'y', 'dobutamine|lasix':'n',
    'dobutamine|lidocaine':'y', 'dobutamine|midazolam':'y', 'dobutamine|norepinephrine':'y',
    'dobutamine|octreotide':'?', 'dobutamine|pantoprazole':'n', 'dobutamine|tng':'y',
    'dobutamine|morphine':'y', 'dobutamine|propofol':'y', 'dobutamine|vancomycin':'y',
    'dobutamine|piperacillin':'?', 'dobutamine|ceftriaxone':'y', 'dobutamine|meropenem':'?',
    'dobutamine|potassium':'y', 'dobutamine|magnesium':'y', 'dobutamine|ranitidine':'y',
    'dobutamine|sodium_bicarb':'n', 'dobutamine|dexamethasone':'y', 'dobutamine|atropine':'y',
    'dobutamine|cefazolin':'?', 'dobutamine|ceftazidime':'?',
    'dobutamine|acetaminophen':'y', 'dobutamine|levetiracetam':'y',

    // ── DOPAMINE ──
    'dopamine|fentanyl':'y', 'dopamine|heparin':'y', 'dopamine|insulin':'y',
    'dopamine|labetalol':'y', 'dopamine|lasix':'n', 'dopamine|lidocaine':'y',
    'dopamine|midazolam':'y', 'dopamine|norepinephrine':'y', 'dopamine|octreotide':'?',
    'dopamine|pantoprazole':'n', 'dopamine|tng':'y', 'dopamine|morphine':'y',
    'dopamine|propofol':'y', 'dopamine|vancomycin':'y', 'dopamine|piperacillin':'y',
    'dopamine|ceftriaxone':'y', 'dopamine|meropenem':'y', 'dopamine|potassium':'y',
    'dopamine|magnesium':'y', 'dopamine|ranitidine':'y', 'dopamine|dexamethasone':'y',
    'dopamine|hydrocortisone':'y', 'dopamine|sodium_bicarb':'n', 'dopamine|atropine':'y',
    'dopamine|cefazolin':'y', 'dopamine|ceftazidime':'y',
    'dopamine|acetaminophen':'y', 'dopamine|levetiracetam':'y',

    // ── FENTANYL ──
    'fentanyl|heparin':'y', 'fentanyl|insulin':'?', 'fentanyl|labetalol':'y',
    'fentanyl|lasix':'n', 'fentanyl|lidocaine':'y', 'fentanyl|midazolam':'y',
    'fentanyl|norepinephrine':'v', // conflicting at high concentration
    'fentanyl|octreotide':'?', 'fentanyl|pantoprazole':'n', 'fentanyl|tng':'y',
    'fentanyl|morphine':'y', 'fentanyl|propofol':'y', 'fentanyl|vancomycin':'y',
    'fentanyl|piperacillin':'y', 'fentanyl|ceftriaxone':'y', 'fentanyl|meropenem':'y',
    'fentanyl|potassium':'y', 'fentanyl|magnesium':'y', 'fentanyl|ranitidine':'y',
    'fentanyl|dexamethasone':'y', 'fentanyl|hydrocortisone':'y',
    'fentanyl|sodium_bicarb':'?', 'fentanyl|atropine':'y',
    'fentanyl|cefazolin':'y', 'fentanyl|ceftazidime':'y',
    'fentanyl|acetaminophen':'y', 'fentanyl|levetiracetam':'y',

    // ── HEPARIN ──
    'heparin|insulin':'y', 'heparin|labetalol':'?', 'heparin|lasix':'y',
    'heparin|lidocaine':'y', 'heparin|midazolam':'y', 'heparin|norepinephrine':'n',
    'heparin|octreotide':'y', 'heparin|pantoprazole':'n',
    'heparin|tng':'v', // conflicting in some formulations
    'heparin|morphine':'y', 'heparin|propofol':'y', 'heparin|vancomycin':'n',
    'heparin|piperacillin':'y', 'heparin|ceftriaxone':'y', 'heparin|meropenem':'?',
    'heparin|potassium':'y', 'heparin|magnesium':'y', 'heparin|ranitidine':'y',
    'heparin|dexamethasone':'y', 'heparin|hydrocortisone':'y', 'heparin|sodium_bicarb':'y',
    'heparin|acetaminophen':'y', 'heparin|levetiracetam':'y',

    // ── INSULIN ──
    'insulin|labetalol':'?', 'insulin|lasix':'?', 'insulin|lidocaine':'?',
    'insulin|midazolam':'?', 'insulin|norepinephrine':'?', 'insulin|octreotide':'?',
    'insulin|pantoprazole':'n', 'insulin|tng':'?', 'insulin|morphine':'?',
    'insulin|propofol':'?', 'insulin|vancomycin':'?', 'insulin|potassium':'y',
    'insulin|magnesium':'?', 'insulin|ranitidine':'?', 'insulin|sodium_bicarb':'?',

    // ── LABETALOL ──
    'labetalol|lasix':'?', 'labetalol|lidocaine':'y', 'labetalol|midazolam':'y',
    'labetalol|norepinephrine':'?', 'labetalol|octreotide':'?', 'labetalol|pantoprazole':'?',
    'labetalol|tng':'y', 'labetalol|morphine':'y', 'labetalol|propofol':'y',
    'labetalol|vancomycin':'?', 'labetalol|potassium':'y', 'labetalol|magnesium':'y',
    'labetalol|ranitidine':'y', 'labetalol|sodium_bicarb':'n',
    'labetalol|acetaminophen':'y', 'labetalol|levetiracetam':'?',

    // ── LASIX (FUROSEMIDE) ──
    'lasix|lidocaine':'?', 'lasix|midazolam':'n', 'lasix|norepinephrine':'?',
    'lasix|octreotide':'?', 'lasix|pantoprazole':'y', 'lasix|tng':'?',
    'lasix|morphine':'n', 'lasix|propofol':'n',
    'lasix|vancomycin':'v', // some reports of compatibility, verify locally
    'lasix|piperacillin':'y', 'lasix|ceftriaxone':'y', 'lasix|meropenem':'y',
    'lasix|potassium':'y', 'lasix|magnesium':'y', 'lasix|ranitidine':'n',
    'lasix|dexamethasone':'y', 'lasix|hydrocortisone':'y', 'lasix|sodium_bicarb':'y',
    'lasix|acetaminophen':'y', 'lasix|levetiracetam':'?',

    // ── LIDOCAINE ──
    'lidocaine|midazolam':'y', 'lidocaine|norepinephrine':'y', 'lidocaine|octreotide':'?',
    'lidocaine|pantoprazole':'?', 'lidocaine|tng':'y', 'lidocaine|morphine':'y',
    'lidocaine|propofol':'y', 'lidocaine|vancomycin':'y', 'lidocaine|potassium':'y',
    'lidocaine|magnesium':'y', 'lidocaine|ranitidine':'y', 'lidocaine|sodium_bicarb':'n',

    // ── MIDAZOLAM ──
    'midazolam|norepinephrine':'y', 'midazolam|octreotide':'?', 'midazolam|pantoprazole':'n',
    'midazolam|tng':'y', 'midazolam|morphine':'y', 'midazolam|propofol':'y',
    'midazolam|vancomycin':'y', 'midazolam|piperacillin':'?', 'midazolam|ceftriaxone':'y',
    'midazolam|meropenem':'y', 'midazolam|potassium':'y', 'midazolam|magnesium':'y',
    'midazolam|ranitidine':'y', 'midazolam|dexamethasone':'y', 'midazolam|sodium_bicarb':'?',
    'midazolam|acetaminophen':'y', 'midazolam|levetiracetam':'y',

    // ── NOREPINEPHRINE ──
    'norepinephrine|octreotide':'?', 'norepinephrine|pantoprazole':'n', 'norepinephrine|tng':'y',
    'norepinephrine|morphine':'y', 'norepinephrine|propofol':'y', 'norepinephrine|vancomycin':'y',
    'norepinephrine|piperacillin':'?', 'norepinephrine|ceftriaxone':'y', 'norepinephrine|meropenem':'?',
    'norepinephrine|potassium':'y', 'norepinephrine|magnesium':'y', 'norepinephrine|ranitidine':'y',
    'norepinephrine|dexamethasone':'y', 'norepinephrine|sodium_bicarb':'n',
    'norepinephrine|acetaminophen':'y', 'norepinephrine|levetiracetam':'y',
    'norepinephrine|hydrocortisone':'y',

    // ── OCTREOTIDE ──
    'octreotide|pantoprazole':'?', 'octreotide|tng':'?', 'octreotide|morphine':'?',
    'octreotide|propofol':'?', 'octreotide|vancomycin':'?', 'octreotide|potassium':'?',

    // ── PANTOPRAZOLE ──
    'pantoprazole|tng':'n', 'pantoprazole|morphine':'n', 'pantoprazole|propofol':'n',
    'pantoprazole|vancomycin':'v', // limited data — verify locally
    'pantoprazole|piperacillin':'y', 'pantoprazole|ceftriaxone':'n',
    'pantoprazole|meropenem':'y', 'pantoprazole|potassium':'?', 'pantoprazole|magnesium':'?',
    'pantoprazole|ranitidine':'n', 'pantoprazole|dexamethasone':'?',
    'pantoprazole|sodium_bicarb':'n', 'pantoprazole|atropine':'?',
    'pantoprazole|acetaminophen':'?', 'pantoprazole|levetiracetam':'?',
    'pantoprazole|cefazolin':'?', 'pantoprazole|ceftazidime':'?',

    // ── TNG (NITROGLYCERIN) ──
    'tng|morphine':'y', 'tng|propofol':'?', 'tng|vancomycin':'y',
    'tng|piperacillin':'?', 'tng|ceftriaxone':'?', 'tng|potassium':'y',
    'tng|magnesium':'y', 'tng|ranitidine':'y', 'tng|dexamethasone':'y',
    'tng|acetaminophen':'?', 'tng|levetiracetam':'?',

    // ── MORPHINE ──
    'morphine|propofol':'y', 'morphine|vancomycin':'y', 'morphine|piperacillin':'n',
    'morphine|ceftriaxone':'n', 'morphine|meropenem':'y', 'morphine|potassium':'y',
    'morphine|magnesium':'y', 'morphine|ranitidine':'y', 'morphine|dexamethasone':'y',
    'morphine|hydrocortisone':'y', 'morphine|sodium_bicarb':'?', 'morphine|atropine':'y',
    'morphine|cefazolin':'y', 'morphine|ceftazidime':'?',
    'morphine|acetaminophen':'y', 'morphine|levetiracetam':'y',

    // ── PROPOFOL ──
    'propofol|vancomycin':'n', 'propofol|piperacillin':'y', 'propofol|ceftriaxone':'?',
    'propofol|meropenem':'y', 'propofol|potassium':'y', 'propofol|magnesium':'y',
    'propofol|ranitidine':'?', 'propofol|dexamethasone':'y', 'propofol|hydrocortisone':'?',
    'propofol|acetaminophen':'?', 'propofol|levetiracetam':'?',

    // ── VANCOMYCIN ──
    'vancomycin|piperacillin':'n', 'vancomycin|ceftriaxone':'n', 'vancomycin|meropenem':'y',
    'vancomycin|potassium':'y', 'vancomycin|magnesium':'y', 'vancomycin|ranitidine':'y',
    'vancomycin|dexamethasone':'y', 'vancomycin|hydrocortisone':'y',
    'vancomycin|sodium_bicarb':'?', 'vancomycin|atropine':'y',
    'vancomycin|cefazolin':'n', 'vancomycin|ceftazidime':'n',
    'vancomycin|acetaminophen':'y', 'vancomycin|levetiracetam':'y',

    // ── PIPERACILLIN-TAZOBACTAM ──
    'piperacillin|ceftriaxone':'n', 'piperacillin|meropenem':'?', 'piperacillin|potassium':'y',
    'piperacillin|magnesium':'y', 'piperacillin|ranitidine':'y', 'piperacillin|dexamethasone':'y',
    'piperacillin|hydrocortisone':'y', 'piperacillin|sodium_bicarb':'?', 'piperacillin|atropine':'y',
    'piperacillin|cefazolin':'n', 'piperacillin|ceftazidime':'?',
    'piperacillin|acetaminophen':'y', 'piperacillin|levetiracetam':'y',

    // ── CEFTRIAXONE ──
    'ceftriaxone|meropenem':'?', 'ceftriaxone|potassium':'y', 'ceftriaxone|magnesium':'n',
    'ceftriaxone|ranitidine':'y', 'ceftriaxone|dexamethasone':'y', 'ceftriaxone|hydrocortisone':'y',
    'ceftriaxone|sodium_bicarb':'?', 'ceftriaxone|atropine':'y',
    'ceftriaxone|cefazolin':'?', 'ceftriaxone|ceftazidime':'?',
    'ceftriaxone|acetaminophen':'y', 'ceftriaxone|levetiracetam':'y',

    // ── MEROPENEM ──
    'meropenem|potassium':'y', 'meropenem|magnesium':'y', 'meropenem|ranitidine':'y',
    'meropenem|dexamethasone':'y', 'meropenem|hydrocortisone':'y', 'meropenem|sodium_bicarb':'?',
    'meropenem|acetaminophen':'y', 'meropenem|levetiracetam':'y',

    // ── POTASSIUM CHLORIDE ──
    'potassium|magnesium':'y', 'potassium|ranitidine':'y', 'potassium|dexamethasone':'y',
    'potassium|hydrocortisone':'y', 'potassium|sodium_bicarb':'?', 'potassium|atropine':'y',
    'potassium|cefazolin':'y', 'potassium|ceftazidime':'y',
    'potassium|acetaminophen':'y', 'potassium|levetiracetam':'y',

    // ── MAGNESIUM SULFATE ──
    'magnesium|ranitidine':'y', 'magnesium|dexamethasone':'y', 'magnesium|hydrocortisone':'y',
    'magnesium|sodium_bicarb':'?', 'magnesium|atropine':'y',
    'magnesium|cefazolin':'?', 'magnesium|ceftazidime':'?',
    'magnesium|acetaminophen':'y', 'magnesium|levetiracetam':'y', 'magnesium|ceftriaxone':'n',

    // ── RANITIDINE ──
    'ranitidine|dexamethasone':'y', 'ranitidine|hydrocortisone':'y', 'ranitidine|sodium_bicarb':'y',
    'ranitidine|acetaminophen':'y', 'ranitidine|levetiracetam':'y',

    // ── DEXAMETHASONE ──
    'dexamethasone|hydrocortisone':'?', 'dexamethasone|sodium_bicarb':'?',
    'dexamethasone|acetaminophen':'y', 'dexamethasone|levetiracetam':'y',

    // ── HYDROCORTISONE ──
    'hydrocortisone|sodium_bicarb':'?', 'hydrocortisone|atropine':'y',
    'hydrocortisone|ceftazidime':'?', 'hydrocortisone|acetaminophen':'?',
    'hydrocortisone|levetiracetam':'?',

    // ── SODIUM BICARBONATE ──
    'sodium_bicarb|phenytoin':'n', 'sodium_bicarb|cefazolin':'?',
    'sodium_bicarb|ceftazidime':'?', 'sodium_bicarb|acetaminophen':'?',
    'sodium_bicarb|levetiracetam':'y',

    // ── ATROPINE ──
    'atropine|cefazolin':'y', 'atropine|ceftazidime':'y',
    'atropine|acetaminophen':'y', 'atropine|levetiracetam':'?', 'atropine|phenytoin':'?',

    // ── VASOPRESSIN ──

    // ── EPINEPHRINE ──
    'epinephrine|ceftazidime':'?', 'epinephrine|acetaminophen':'y',
    'epinephrine|levetiracetam':'?', 'epinephrine|phenytoin':'n',

    // ── DEXMEDETOMIDINE ──

    // ── CEFAZOLIN ──
    'cefazolin|ceftazidime':'?', 'cefazolin|acetaminophen':'y', 'cefazolin|levetiracetam':'y',
    'cefazolin|phenytoin':'n', 'cefazolin|vancomycin':'n',

    // ── CEFTAZIDIME ──
    'ceftazidime|acetaminophen':'y', 'ceftazidime|levetiracetam':'y',
    'ceftazidime|phenytoin':'?', 'ceftazidime|vancomycin':'n',

    // ── ACETAMINOPHEN / LEVETIRACETAM / PHENYTOIN ──
    'acetaminophen|levetiracetam':'y', 'acetaminophen|phenytoin':'?',
    'levetiracetam|phenytoin':'?',

    // ── CIPROFLOXACIN ──
    'ciprofloxacin|heparin':'n', 'ciprofloxacin|dopamine':'?', 'ciprofloxacin|dobutamine':'?',
    'ciprofloxacin|norepinephrine':'?', 'ciprofloxacin|fentanyl':'y', 'ciprofloxacin|midazolam':'y',
    'ciprofloxacin|morphine':'?', 'ciprofloxacin|propofol':'?', 'ciprofloxacin|vancomycin':'n',
    'ciprofloxacin|piperacillin':'n', 'ciprofloxacin|ceftriaxone':'n', 'ciprofloxacin|ceftazidime':'n',
    'ciprofloxacin|cefazolin':'n', 'ciprofloxacin|meropenem':'n', 'ciprofloxacin|potassium':'y',
    'ciprofloxacin|magnesium':'n', 'ciprofloxacin|ranitidine':'y', 'ciprofloxacin|dexamethasone':'?',
    'ciprofloxacin|hydrocortisone':'?', 'ciprofloxacin|sodium_bicarb':'n', 'ciprofloxacin|atropine':'?',
    'ciprofloxacin|acetaminophen':'?', 'ciprofloxacin|levetiracetam':'?', 'ciprofloxacin|phenytoin':'n',
    'ciprofloxacin|amiodarone':'?', 'ciprofloxacin|lidocaine':'?', 'ciprofloxacin|labetalol':'?',
    'ciprofloxacin|tng':'?', 'ciprofloxacin|lasix':'?', 'ciprofloxacin|pantoprazole':'?',
    'ciprofloxacin|insulin':'?', 'ciprofloxacin|octreotide':'?', 'ciprofloxacin|epinephrine':'?',
};


const YSITE_EXTRA_DRUGS = [
    { id:'morphine',       name:'مورفین',                en:'Morphine' },
    { id:'propofol',       name:'پروپوفول',              en:'Propofol' },
    { id:'vancomycin',     name:'وانکومایسین',           en:'Vancomycin' },
    { id:'piperacillin',   name:'پیپراسیلین-تازوباکتام', en:'Pip-Taz' },
    { id:'cefazolin',      name:'سفازولین',              en:'Cefazolin' },
    { id:'ceftazidime',    name:'سفتازیدیم',             en:'Ceftazidime' },
    { id:'ceftriaxone',    name:'سفتریاکسون',            en:'Ceftriaxone' },
    { id:'ciprofloxacin',  name:'سیپروفلوکساسین',        en:'Ciprofloxacin' },
    { id:'meropenem',      name:'مروپنم',                en:'Meropenem' },
    { id:'potassium',      name:'پتاسیم کلراید',         en:'KCl' },
    { id:'magnesium',      name:'منیزیم سولفات',         en:'MgSO₄' },
    { id:'ranitidine',     name:'رانیتیدین',             en:'Ranitidine' },
    { id:'dexamethasone',  name:'دگزامتازون',            en:'Dexamethasone' },
    { id:'hydrocortisone', name:'هیدروکورتیزون',         en:'Hydrocortisone' },
    { id:'acetaminophen',  name:'استامینوفن (آپوتل)',    en:'Acetaminophen IV' },
    { id:'levetiracetam',  name:'لوتیراستام (کپرا)',     en:'Levetiracetam' },
    { id:'sodium_bicarb',  name:'بی‌کربنات سدیم',        en:'NaHCO₃' },
    { id:'atropine',       name:'آتروپین',               en:'Atropine' },
    { id:'phenytoin',      name:'فنی‌توئین',             en:'Phenytoin' },
];


function ysiteKey(a, b) {
    return [a, b].sort().join('|');
}

function ysiteStatus(a, b) {
    if (a === b) return 'same';
    return YSITE_MATRIX[ysiteKey(a, b)] || '?';
}

function setupYSiteChecker() {
    const grid = document.getElementById('ysiteDrugGrid');
    const resetBtn = document.getElementById('ysiteResetBtn');
    if (!grid) return;

    const selected = new Set();

    function addChip(id, persianName, enName, isExtra) {
        const chip = document.createElement('button');
        chip.className = 'ysite-drug-chip' + (isExtra ? ' ysite-chip-extra' : '');
        chip.dataset.id = id;
        chip.title = enName || '';
        chip.innerHTML = `<span>${persianName}</span>`;
        chip.addEventListener('click', () => {
            if (selected.has(id)) {
                selected.delete(id);
                chip.classList.remove('selected');
            } else {
                selected.add(id);
                chip.classList.add('selected');
            }
            renderMatrix(selected);
        });
        grid.appendChild(chip);
    }

    // All drugs in one flat list — app drugs first, then reference drugs
    Object.values(drugDatabase).forEach(drug => {
        addChip(drug.id, drug.persianName, drug.englishName, false);
    });
    if (typeof YSITE_EXTRA_DRUGS !== 'undefined') {
        YSITE_EXTRA_DRUGS.forEach(d => addChip(d.id, d.name, d.en, false));
    }

    if (resetBtn) resetBtn.addEventListener('click', () => {
        selected.clear();
        grid.querySelectorAll('.ysite-drug-chip').forEach(c => c.classList.remove('selected'));
        renderMatrix(selected);
        haptic(20);
    });
}

function renderMatrix(selected) {
    const wrap = document.getElementById('ysiteMatrixWrap');
    const matrix = document.getElementById('ysiteMatrix');
    if (!wrap || !matrix) return;

    const ids = Array.from(selected);
    if (ids.length < 2) {
        wrap.style.display = 'none';
        return;
    }

    wrap.style.display = 'block';

    // Resolve name — app drugs or extra reference drugs
    const _extraMap = {};
    if (typeof YSITE_EXTRA_DRUGS !== 'undefined') YSITE_EXTRA_DRUGS.forEach(d => { _extraMap[d.id] = d.name; });
    const names = ids.map(id => drugDatabase[id]?.persianName || _extraMap[id] || id);

    // Build table
    let html = '<table class="ysite-table"><thead><tr><th></th>';
    names.forEach(n => { html += `<th class="ysite-th">${n}</th>`; });
    html += '</tr></thead><tbody>';

    ids.forEach((rowId, ri) => {
        html += `<tr><td class="ysite-row-label">${names[ri]}</td>`;
        ids.forEach((colId, ci) => {
            if (ri === ci) {
                html += '<td class="ysite-cell ysite-same">—</td>';
            } else {
                const status = ysiteStatus(rowId, colId);
                const cls = status === 'y' ? 'ysite-ok' : status === 'n' ? 'ysite-no' : status === 'v' ? 'ysite-verify' : 'ysite-unk';
                const icon = status === 'y' ? '✓' : status === 'n' ? '✕' : status === 'v' ? '!' : '?';
                html += `<td class="ysite-cell ${cls}" title="${names[ri]} + ${names[ci]}">${icon}</td>`;
            }
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    html += `<div class="ysite-legend">
        <span class="ysite-legend-item ysite-ok">🟢 سازگار</span>
        <span class="ysite-legend-item ysite-no">🔴 ناسازگار</span>
        <span class="ysite-legend-item ysite-verify">🟡 محدود / متناقض</span>
        <span class="ysite-legend-item ysite-unk">⚪ بدون داده</span>
    </div>`;

    matrix.innerHTML = html;
    haptic(15);

    // Scroll matrix into view
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

// ============================================
// VENTILATOR TIDAL VOLUME CALCULATOR
// ============================================
function setupVentilatorCalc() {
    const genderBtns = document.querySelectorAll('#ventGenderBtns .method-btn-compact');
    genderBtns.forEach(btn => btn.addEventListener('click', function() {
        genderBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
    }));

    const tabs = document.querySelectorAll('#ventMethodTabs .vent-tab');
    tabs.forEach(tab => tab.addEventListener('click', function() {
        tabs.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.vent-input-panel').forEach(p => p.style.display = 'none');
        const panel = document.getElementById('ventPanel_' + this.dataset.tab);
        if (panel) panel.style.display = 'block';
    }));
}

window.calculateVentTV = function() {
    const genderBtn = document.querySelector('#ventGenderBtns .method-btn-compact.active');
    const gender = genderBtn ? genderBtn.dataset.gender : 'male';
    const activeTab = document.querySelector('#ventMethodTabs .vent-tab.active');
    const method = activeTab ? activeTab.dataset.tab : 'height';
    const resultDiv = document.getElementById('ventResult');

    let heightCm = null;
    let estimationNote = '';

    if (method === 'height') {
        heightCm = PersianNumbers.parseNumber(document.getElementById('ventHeight')?.value);
        if (!heightCm || isNaN(heightCm) || heightCm < 100 || heightCm > 230) {
            showToast('خطا', 'قد را به درستی وارد کنید (100–230 cm)', 'error'); return;
        }
    } else if (method === 'ulna') {
        const ulna = PersianNumbers.parseNumber(document.getElementById('ventUlna')?.value);
        if (!ulna || isNaN(ulna)) { showToast('خطا', 'طول اولنا را وارد کنید', 'error'); return; }
        heightCm = gender === 'male' ? (3.294 * ulna + 82.7) : (3.316 * ulna + 81.3);
        estimationNote = `قد تخمینی از طول اولنا (${ulna} cm): <strong>${heightCm.toFixed(1)} cm</strong>`;
    }

    const heightInch = heightCm / 2.54;
    const pbw = gender === 'male'
        ? 50 + 2.3 * (heightInch - 60)
        : 45.5 + 2.3 * (heightInch - 60);

    if (pbw < 20) { showToast('خطا', 'قد وارد شده خیلی کوتاه است', 'error'); return; }

    const tv4  = pbw * 4;
    const tv6  = pbw * 6;
    const tv7  = pbw * 7;
    const tv8  = pbw * 8;

    resultDiv.innerHTML = `
        ${estimationNote ? `<div class="vent-estimation">${estimationNote}</div>` : ''}
        <div class="vent-pbw-row">
            <span>وزن پیش‌بینی‌شده <span class="latin-inline">(PBW)</span></span>
            <strong><span class="latin-inline">${pbw.toFixed(1)} kg</span></strong>
        </div>
        <div class="vent-tv-grid">
            <div class="vent-tv-item">
                <div class="vent-tv-label"><span class="latin-inline">4 mL/kg</span></div>
                <div class="vent-tv-value"><span class="latin-inline">${Math.round(tv4)}</span></div>
                <div class="vent-tv-unit"><span class="latin-inline">mL</span></div>
                <div class="vent-tv-note">حداقل — <span class="latin-inline">ARDS</span> شدید</div>
            </div>
            <div class="vent-tv-item vent-tv-target">
                <div class="vent-tv-label"><span class="latin-inline">6 mL/kg</span></div>
                <div class="vent-tv-value"><span class="latin-inline">${Math.round(tv6)}</span></div>
                <div class="vent-tv-unit"><span class="latin-inline">mL</span></div>
                <div class="vent-tv-note">🎯 هدف — تهویه حفاظتی</div>
            </div>
            <div class="vent-tv-item">
                <div class="vent-tv-label"><span class="latin-inline">7 mL/kg</span></div>
                <div class="vent-tv-value"><span class="latin-inline">${Math.round(tv7)}</span></div>
                <div class="vent-tv-unit"><span class="latin-inline">mL</span></div>
                <div class="vent-tv-note">مرز بالایی قابل قبول</div>
            </div>
            <div class="vent-tv-item vent-tv-warn">
                <div class="vent-tv-label"><span class="latin-inline">8 mL/kg</span></div>
                <div class="vent-tv-value"><span class="latin-inline">${Math.round(tv8)}</span></div>
                <div class="vent-tv-unit"><span class="latin-inline">mL</span></div>
                <div class="vent-tv-note">⚠️ فقط در موارد استثنا</div>
            </div>
        </div>
        <div class="vent-note"><span class="latin-inline">ARDSNet</span> — فرمول <span class="latin-inline">Devine</span> برای <span class="latin-inline">PBW</span></div>
    `;
    resultDiv.style.display = 'block';
    haptic(40);
    setTimeout(() => resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
};

// ============================================
// NUTRITIONAL REQUIREMENTS CALCULATOR
// ============================================
window.calculateNutrition = function() {
    const weight  = PersianNumbers.parseNumber(document.getElementById('nutWeight')?.value);
    const height  = PersianNumbers.parseNumber(document.getElementById('nutHeight')?.value);
    const age     = PersianNumbers.parseNumber(document.getElementById('nutAge')?.value);
    const genderBtn = document.querySelector('#nutGenderBtns .method-btn-compact.active');
    const gender  = genderBtn ? genderBtn.dataset.gender : 'male';
    const stress  = parseFloat(document.getElementById('nutStress')?.value || '1.2');
    const resultDiv = document.getElementById('nutResult');

    if (!weight || isNaN(weight) || weight < 20) { showToast('خطا', 'وزن را وارد کنید', 'error'); return; }
    if (!height || isNaN(height) || height < 100) { showToast('خطا', 'قد را وارد کنید', 'error'); return; }
    if (!age    || isNaN(age)    || age < 1)      { showToast('خطا', 'سن را وارد کنید', 'error'); return; }

    let bmr_hb, bmr_ms;
    if (gender === 'male') {
        bmr_hb = 66.5 + (13.75 * weight) + (5.003 * height) - (6.75 * age);
        bmr_ms = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
        bmr_hb = 655.1 + (9.563 * weight) + (1.850 * height) - (4.676 * age);
        bmr_ms = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    const activityFactor = 1.05;
    const tee_ms = Math.round(bmr_ms * activityFactor * stress);

    let proteinMin, proteinMax, proteinNote;
    if (stress <= 1.1) {
        proteinMin = 0.8; proteinMax = 1.0;
        proteinNote = 'نیاز طبیعی';
    } else if (stress <= 1.3) {
        proteinMin = 1.2; proteinMax = 1.5;
        proteinNote = 'ICU / بعد از جراحی';
    } else if (stress <= 1.6) {
        proteinMin = 1.5; proteinMax = 2.0;
        proteinNote = 'سپسیس / تروما';
    } else {
        proteinMin = 1.5; proteinMax = 2.5;
        proteinNote = 'سوختگی / ARDS';
    }

    const protMinG = Math.round(proteinMin * weight);
    const protMaxG = Math.round(proteinMax * weight);
    const protMinKcal = Math.round(protMinG * 4);
    const protMaxKcal = Math.round(protMaxG * 4);

    const npcMin = tee_ms - protMaxKcal;
    const enteralRateMin = Math.round(npcMin / 24);
    const enteralRateMax = Math.round(tee_ms / 24);
    const fluidFromFeed = Math.round(enteralRateMax * 0.85);

    resultDiv.innerHTML = `
        <div class="nut-section">
            <div class="nut-section-title"><i class="fas fa-fire"></i> نیاز کالری</div>
            <div class="nut-row"><span>BMR — Harris-Benedict</span><strong>${bmr_hb.toFixed(0)} kcal/day</strong></div>
            <div class="nut-row"><span>BMR — Mifflin-St Jeor</span><strong>${bmr_ms.toFixed(0)} kcal/day</strong></div>
            <div class="nut-row nut-row-highlight"><span>هدف کالری روزانه (×${stress})</span><strong>${tee_ms} kcal/day</strong></div>
            <div class="nut-row nut-row-sub"><span>معادل کالری ساعتی</span><strong>${Math.round(tee_ms/24)} kcal/hr</strong></div>
        </div>
        <div class="nut-section">
            <div class="nut-section-title"><i class="fas fa-dna"></i> نیاز پروتئین — ${proteinNote}</div>
            <div class="nut-row"><span>محدوده پروتئین</span><strong>${proteinMin}–${proteinMax} g/kg/day</strong></div>
            <div class="nut-row nut-row-highlight"><span>هدف پروتئین روزانه</span><strong>${protMinG}–${protMaxG} g/day</strong></div>
            <div class="nut-row nut-row-sub"><span>معادل کالری پروتئین</span><strong>${protMinKcal}–${protMaxKcal} kcal/day</strong></div>
        </div>
        <div class="nut-section">
            <div class="nut-section-title"><i class="fas fa-syringe"></i> تغذیه انترال (فرمول ۱ kcal/mL)</div>
            <div class="nut-row nut-row-highlight"><span>سرعت پیشنهادی</span><strong>${enteralRateMin}–${enteralRateMax} mL/hr</strong></div>
            <div class="nut-row nut-row-sub"><span>آب آزاد از تغذیه</span><strong>~${fluidFromFeed} mL/day</strong></div>
        </div>
        <div class="nut-disclaimer"><i class="fas fa-triangle-exclamation"></i> این محاسبه راهنما است. تغذیه بیماران بحرانی باید با متخصص تغذیه هماهنگ شود.</div>
    `;
    resultDiv.style.display = 'block';
    haptic(40);
    setTimeout(() => resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
};

(function setupNutritionGender() {
    document.addEventListener('DOMContentLoaded', () => {
        const genderBtns = document.querySelectorAll('#nutGenderBtns .method-btn-compact');
        genderBtns.forEach(btn => btn.addEventListener('click', function() {
            genderBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        }));
    });
})();

// ============================================
// VBG / ABG INTERPRETER
// ============================================
// ============================================
// VBG / ABG INTERPRETER — Clinically Accurate Engine
// Based on standard ICU/EM acid-base diagnostic workflow
// ============================================

// ── Utility ──────────────────────────────────────────────────────────────────
function _vbgRange(val, lo, hi) { return val >= lo && val <= hi; }
function _vbgFmt(n, d) { return isNaN(n) ? '—' : n.toFixed(d); }

// ── Step 1: Primary pH status ────────────────────────────────────────────────
function vbgStep1(pH) {
    if (pH < 7.35) return 'acidemia';
    if (pH > 7.45) return 'alkalemia';
    return 'normal';
}

// ── Step 2: Identify abnormal variables ──────────────────────────────────────
function vbgStep2(pco2, hco3) {
    return {
        pco2High: pco2 > 45,
        pco2Low:  pco2 < 35,
        hco3High: hco3 > 26,
        hco3Low:  hco3 < 22,
    };
}

// ── Step 3 + 4: Primary disorder + expected compensation ─────────────────────
function vbgStep3(phStatus, pco2, hco3, v) {
    // Returns array of disorder objects: { type, label, compensation }
    const disorders = [];

    if (phStatus === 'acidemia') {
        // Could be metabolic, respiratory, or both
        if (v.pco2High) {
            // Respiratory acidosis present
            const exp_acute   = 24 + 1   * (pco2 - 40) / 10;
            const exp_chronic = 24 + 3.5 * (pco2 - 40) / 10;
            let compNote, isMixed = false;
            if (hco3 < exp_acute - 2) {
                compNote = `HCO₃ پایین‌تر از جبران حاد — احتمال آسیدوز متابولیک همزمان`;
                isMixed = true;
            } else if (_vbgRange(hco3, exp_acute - 2, exp_acute + 2)) {
                compNote = `جبران متابولیک مناسب برای آسیدوز تنفسی حاد (HCO₃ انتظاری: ${exp_acute.toFixed(1)})`;
            } else if (_vbgRange(hco3, exp_acute + 2, exp_chronic + 2)) {
                compNote = `جبران متابولیک در محدوده مزمن (HCO₃ انتظاری حاد: ${exp_acute.toFixed(1)}, مزمن: ${exp_chronic.toFixed(1)})`;
            } else if (hco3 > exp_chronic + 2) {
                compNote = `HCO₃ بالاتر از جبران مزمن — احتمال آلکالوز متابولیک همزمان`;
                isMixed = true;
            }
            disorders.push({ type:'resp_acidosis', label:'آسیدوز تنفسی', compNote, isMixed });
        }
        if (v.hco3Low) {
            // Metabolic acidosis present — apply Winter's formula
            const exp_pco2 = 1.5 * hco3 + 8;
            let compNote, isMixed = false;
            if (_vbgRange(pco2, exp_pco2 - 2, exp_pco2 + 2)) {
                compNote = `جبران تنفسی مناسب — فرمول Winter (pCO₂ انتظاری: ${exp_pco2.toFixed(1)} mmHg)`;
            } else if (pco2 > exp_pco2 + 2) {
                compNote = `pCO₂ بالاتر از انتظار — آسیدوز تنفسی همزمان (pCO₂ انتظاری: ${exp_pco2.toFixed(1)})`;
                isMixed = true;
            } else {
                compNote = `pCO₂ پایین‌تر از انتظار — آلکالوز تنفسی همزمان (pCO₂ انتظاری: ${exp_pco2.toFixed(1)})`;
                isMixed = true;
            }
            disorders.push({ type:'meta_acidosis', label:'آسیدوز متابولیک', compNote, isMixed });
        }
        // If pH acidemic but neither pco2 high nor hco3 low — unusual, flag both
        if (!v.pco2High && !v.hco3Low) {
            disorders.push({ type:'meta_acidosis', label:'آسیدوز متابولیک', compNote:'HCO₃ در مرز — اطلاعات ناکافی برای جبران', isMixed: false });
        }

    } else if (phStatus === 'alkalemia') {
        if (v.pco2Low) {
            // Respiratory alkalosis
            const exp_acute   = 24 - 2 * (40 - pco2) / 10;
            const exp_chronic = 24 - 5 * (40 - pco2) / 10;
            let compNote, isMixed = false;
            if (hco3 > exp_acute + 2) {
                compNote = `HCO₃ بالاتر از جبران حاد — احتمال آلکالوز متابولیک همزمان`;
                isMixed = true;
            } else if (_vbgRange(hco3, exp_acute - 2, exp_acute + 2)) {
                compNote = `جبران متابولیک مناسب برای آلکالوز تنفسی حاد (HCO₃ انتظاری: ${exp_acute.toFixed(1)})`;
            } else if (_vbgRange(hco3, exp_chronic - 2, exp_acute - 2)) {
                compNote = `جبران متابولیک در محدوده مزمن (HCO₃ انتظاری حاد: ${exp_acute.toFixed(1)}, مزمن: ${exp_chronic.toFixed(1)})`;
            } else if (hco3 < exp_chronic - 2) {
                compNote = `HCO₃ پایین‌تر از جبران مزمن — احتمال آسیدوز متابولیک همزمان`;
                isMixed = true;
            }
            disorders.push({ type:'resp_alkalosis', label:'آلکالوز تنفسی', compNote, isMixed });
        }
        if (v.hco3High) {
            // Metabolic alkalosis — expected pCO2 = 0.7×HCO3 + 21 (±2)
            const exp_pco2 = 0.7 * hco3 + 21;
            let compNote, isMixed = false;
            if (_vbgRange(pco2, exp_pco2 - 2, exp_pco2 + 2)) {
                compNote = `جبران تنفسی مناسب (pCO₂ انتظاری: ${exp_pco2.toFixed(1)} mmHg)`;
            } else if (pco2 < exp_pco2 - 2) {
                compNote = `pCO₂ پایین‌تر از انتظار — آلکالوز تنفسی همزمان (pCO₂ انتظاری: ${exp_pco2.toFixed(1)})`;
                isMixed = true;
            } else {
                compNote = `pCO₂ بالاتر از انتظار — آسیدوز تنفسی همزمان (pCO₂ انتظاری: ${exp_pco2.toFixed(1)})`;
                isMixed = true;
            }
            disorders.push({ type:'meta_alkalosis', label:'آلکالوز متابولیک', compNote, isMixed });
        }
        if (!v.pco2Low && !v.hco3High) {
            disorders.push({ type:'meta_alkalosis', label:'آلکالوز متابولیک', compNote:'HCO₃ در مرز — اطلاعات ناکافی برای جبران', isMixed: false });
        }

    } else {
        // Normal pH — look for opposing disorders or true normal
        // Opposing disorder: e.g. metabolic acidosis + respiratory alkalosis → pH normal
        if (v.pco2High && v.hco3High) {
            // Chronic resp acidosis with full metabolic compensation
            const exp_chronic = 24 + 3.5 * (pco2 - 40) / 10;
            if (_vbgRange(hco3, exp_chronic - 2, exp_chronic + 2)) {
                disorders.push({ type:'resp_acidosis_comp', label:'آسیدوز تنفسی مزمن جبران‌شده',
                    compNote:`جبران متابولیک کامل (HCO₃ انتظاری مزمن: ${exp_chronic.toFixed(1)})`, isMixed: false });
            } else {
                disorders.push({ type:'mixed_ra_ma', label:'آسیدوز تنفسی + آلکالوز متابولیک (pH طبیعی)',
                    compNote:'اختلال مختلط — جبران بیش از حد متابولیک', isMixed: true });
            }
        } else if (v.pco2Low && v.hco3Low) {
            disorders.push({ type:'meta_acidosis_comp', label:'آسیدوز متابولیک جبران‌شده',
                compNote:'آلکالوز تنفسی جبرانی — pH به محدوده طبیعی رسیده', isMixed: false });
        } else if (v.hco3Low && v.pco2Low) {
            disorders.push({ type:'mixed', label:'آسیدوز متابولیک + آلکالوز تنفسی (pH طبیعی)',
                compNote:'اختلال مختلط با pH طبیعی', isMixed: true });
        } else if (v.hco3High && v.pco2High) {
            disorders.push({ type:'mixed', label:'آلکالوز متابولیک + آسیدوز تنفسی (pH طبیعی)',
                compNote:'اختلال مختلط با pH طبیعی', isMixed: true });
        } else if (!v.pco2High && !v.pco2Low && !v.hco3High && !v.hco3Low) {
            disorders.push({ type:'normal', label:'طبیعی', compNote:'هیچ اختلال اسید-باز شناخته‌شده‌ای وجود ندارد', isMixed: false });
        } else {
            // Single variable mildly abnormal
            if (v.hco3Low) disorders.push({ type:'meta_acidosis_partial', label:'آسیدوز متابولیک خفیف', compNote:'HCO₃ در مرز پایین', isMixed: false });
            if (v.hco3High) disorders.push({ type:'meta_alkalosis_partial', label:'آلکالوز متابولیک خفیف', compNote:'HCO₃ در مرز بالا', isMixed: false });
            if (v.pco2High) disorders.push({ type:'resp_acidosis_partial', label:'آسیدوز تنفسی خفیف', compNote:'pCO₂ در مرز بالا', isMixed: false });
            if (v.pco2Low)  disorders.push({ type:'resp_alkalosis_partial', label:'آلکالوز تنفسی خفیف', compNote:'pCO₂ در مرز پایین', isMixed: false });
        }
    }

    return disorders;
}

// ── Anion Gap ─────────────────────────────────────────────────────────────────
function vbgAnionGap(na, cl, hco3, alb) {
    if (isNaN(na) || isNaN(cl)) return null;
    const ag_raw = na - (cl + hco3);
    const albCorr = (!isNaN(alb) && alb > 0) ? 2.5 * (4.0 - alb) : 0;
    const ag = ag_raw + albCorr;
    const high = ag > 12;
    const low  = ag < 8;

    let causes = '', dd = null;
    if (high) {
        causes = 'HAGMA: لاکتیک اسیدوز، کتواسیدوز دیابتی، نارسایی کلیوی، سالیسیلات، متانول، اتیلن گلیکول، ایزونیازید';
        const delta_ag   = ag - 12;
        const delta_hco3 = 24 - hco3;
        if (delta_hco3 > 0) {
            dd = delta_ag / delta_hco3;
        }
    } else if (!high && !low) {
        causes = 'NAGMA: اسهال، RTA، هیپرکلرمی، تزریق زیاد سالین نرمال';
    } else if (low) {
        causes = 'آنیون گپ پایین: هیپوآلبومینمی، گاموپاتی، هیپرکلسمی/هیپرمنیزیمی شدید';
    }

    let ddNote = '';
    if (dd !== null) {
        if (dd < 0.8)      ddNote = `Delta ratio ${dd.toFixed(2)} (<0.8): HAGMA + آسیدوز متابولیک طبیعی‌گپ همزمان`;
        else if (dd <= 2)  ddNote = `Delta ratio ${dd.toFixed(2)} (0.8–2): HAGMA خالص`;
        else               ddNote = `Delta ratio ${dd.toFixed(2)} (>2): HAGMA + آلکالوز متابولیک مخفی یا آسیدوز تنفسی مزمن`;
    }

    return { ag, ag_raw, albCorr, high, low, causes, dd, ddNote, albCorrected: albCorr !== 0 };
}

// ── Severity ──────────────────────────────────────────────────────────────────
function vbgSeverity(pH, pco2, hco3) {
    const crits = [];
    if (pH < 7.20)   crits.push('pH بحرانی < 7.20 — اسیدمی شدید، مداخله فوری');
    if (pH > 7.60)   crits.push('pH بحرانی > 7.60 — آلکالمی شدید، مداخله فوری');
    if (pco2 > 70)   crits.push('هیپرکاپنی شدید (pCO₂ > 70) — احتمال نارسایی تنفسی');
    if (pco2 < 20)   crits.push('هیپوکاپنی شدید (pCO₂ < 20) — هیپرونتیلاسیون بحرانی');
    if (hco3 < 10)   crits.push('بی‌کربنات بسیار پایین (< 10) — ذخیره بافری ناکافی');
    if (hco3 > 40)   crits.push('بی‌کربنات بسیار بالا (> 40) — آلکالوز متابولیک شدید');

    const warns = [];
    if (!crits.length) {
        if (pH < 7.30)   warns.push('اسیدمی متوسط (pH 7.20–7.30)');
        if (pH > 7.55)   warns.push('آلکالمی متوسط (pH 7.55–7.60)');
        if (pco2 > 55)   warns.push('هیپرکاپنی متوسط (pCO₂ > 55)');
        if (hco3 < 15)   warns.push('بی‌کربنات پایین (15–10)');
    }

    if (crits.length) return { level: 'critical', items: crits };
    if (warns.length) return { level: 'moderate', items: warns };
    return { level: 'mild', items: [] };
}

// ── Clinical causes per disorder ──────────────────────────────────────────────
function vbgClinicalHints(disorders, agResult) {
    const hints = {};
    const types = disorders.map(d => d.type);

    if (types.includes('meta_acidosis') || types.includes('meta_acidosis_comp')) {
        if (agResult?.high) {
            hints['HAGMA'] = {
                title: 'آسیدوز متابولیک با آنیون گپ بالا',
                causes: ['لاکتیک اسیدوز (سپسیس، شوک، ایسکمی)', 'کتواسیدوز دیابتی (DKA)', 'نارسایی کلیوی', 'سالیسیلات', 'متانول یا اتیلن گلیکول'],
                tests: ['لاکتات', 'قند خون + کتون', 'کراتینین و BUN', 'اسمولالیتی + اسمولار گپ', 'سطح سالیسیلات'],
            };
        } else {
            hints['NAGMA'] = {
                title: 'آسیدوز متابولیک با آنیون گپ طبیعی',
                causes: ['اسهال یا از دست دادن HCO₃', 'RTA (رنال توبولار اسیدوز)', 'تزریق زیاد سالین نرمال', 'هیپرکلرمی', 'فیستول بیلی-پانکراتیک'],
                tests: ['الکترولیت کامل', 'کلسیم و فسفر', 'pH ادرار', 'آنیون گپ ادراری'],
            };
        }
    }
    if (types.some(t => t.includes('resp_acidosis'))) {
        hints['ResAcid'] = {
            title: 'آسیدوز تنفسی',
            causes: ['COPD تشدیدیافته', 'هیپوونتیلاسیون', 'ضعف عصبی-عضلانی (GBS، MG)', 'انسداد راه هوایی', 'اوردوز مواد مخدر'],
            tests: ['CXR', 'Peak flow / spirometry', 'سطح داروها (اپیوئیدها)'],
        };
    }
    if (types.some(t => t.includes('resp_alkalosis'))) {
        hints['ResAlk'] = {
            title: 'آلکالوز تنفسی',
            causes: ['اضطراب / هیپرونتیلاسیون', 'درد حاد', 'سپسیس (اولیه)', 'آمبولی ریوی', 'هیپوکسمی'],
            tests: ['SpO₂ / CXR', 'D-dimer / CT-PA در صورت شک به PE'],
        };
    }
    if (types.some(t => t.includes('meta_alkalosis'))) {
        hints['MetAlk'] = {
            title: 'آلکالوز متابولیک',
            causes: ['استفراغ یا NG suction', 'دیورتیک‌های تیازیدی/لوپ', 'هیپوکالمی', 'هیپرآلدوسترونیسم'],
            tests: ['الکترولیت کامل (K⁺، Cl⁻)', 'Cl⁻ ادراری', 'رنین/آلدوسترون در موارد مزمن'],
        };
    }
    return hints;
}

// ── Build HTML ────────────────────────────────────────────────────────────────
function vbgBuildHTML(pH, pco2, hco3, be, disorders, agResult, severity, hints, isVBG) {
    const phClass = pH < 7.35 ? 'vbg-red' : pH > 7.45 ? 'vbg-blue' : 'vbg-green';
    const co2Class = pco2 > 45 ? 'vbg-red' : pco2 < 35 ? 'vbg-blue' : '';
    const hco3Class = hco3 < 22 ? 'vbg-red' : hco3 > 26 ? 'vbg-blue' : '';
    const beClass = !isNaN(be) ? (be < -2 ? 'vbg-red' : be > 2 ? 'vbg-blue' : '') : '';

    // Primary banner
    const isMixedAny = disorders.some(d => d.isMixed) || disorders.length > 1;
    const bannerClass = disorders[0]?.type === 'normal' ? 'vbg-normal'
        : isMixedAny ? 'vbg-mixed'
        : disorders[0]?.type.includes('acidosis') ? 'vbg-acidosis'
        : disorders[0]?.type.includes('alkalosis') ? 'vbg-alkalosis'
        : 'vbg-normal';

    const primaryTitle = disorders.map(d => d.label).join(' + ') || '—';

    const sevBadge = severity.level === 'critical'
        ? '<span class="vbg-badge vbg-badge-sev">⚠️ بحرانی</span>'
        : severity.level === 'moderate'
            ? '<span class="vbg-badge vbg-badge-mod">متوسط</span>'
            : '<span class="vbg-badge vbg-badge-ok">خفیف / طبیعی</span>';

    // Compensation rows
    const compRows = disorders
        .filter(d => d.compNote)
        .map(d => `<div class="vbg-comp-text">${isMixedAny && disorders.length > 1 ? `<strong>${d.label}:</strong> ` : ''}${d.compNote}</div>`)
        .join('');

    // Anion gap section
    let agHTML = '';
    if (agResult) {
        const agClass = agResult.high ? 'vbg-warn' : '';
        agHTML = `<div class="vbg-section ${agClass}">
            <div class="vbg-section-title"><i class="fas fa-calculator"></i> آنیون گپ</div>
            <div class="vbg-row"><span>AG خام</span><strong>${agResult.ag_raw.toFixed(1)} mEq/L</strong></div>
            ${agResult.albCorrected ? `<div class="vbg-row"><span>AG تصحیح آلبومین</span><strong>${agResult.ag.toFixed(1)} mEq/L</strong></div>` : ''}
            <div class="vbg-row"><span>تفسیر</span><strong class="${agResult.high ? 'vbg-red' : agResult.low ? 'vbg-blue' : 'vbg-green'}">${agResult.high ? 'بالا (HAGMA)' : agResult.low ? 'پایین' : 'طبیعی'}</strong></div>
            ${agResult.causes ? `<div class="vbg-causes">${agResult.causes}</div>` : ''}
            ${agResult.ddNote ? `<div class="vbg-dd"><i class="fas fa-divide"></i> ${agResult.ddNote}</div>` : ''}
        </div>`;
    }

    // Severity section
    let sevHTML = '';
    if (severity.items.length) {
        sevHTML = `<div class="vbg-section ${severity.level === 'critical' ? 'vbg-warn' : ''}">
            <div class="vbg-section-title"><i class="fas fa-triangle-exclamation"></i> ${severity.level === 'critical' ? 'هشدار بحرانی' : 'هشدار'}</div>
            ${severity.items.map(s => `<div class="vbg-comp-text">⚠️ ${s}</div>`).join('')}
        </div>`;
    }

    // Clinical hints
    let hintsHTML = '';
    if (Object.keys(hints).length) {
        hintsHTML = Object.values(hints).map(h => `
            <div class="vbg-section">
                <div class="vbg-section-title"><i class="fas fa-stethoscope"></i> ${h.title}</div>
                <div class="vbg-causes"><strong>علل:</strong> ${h.causes.join('، ')}</div>
                <div class="vbg-causes"><strong>بررسی‌های پیشنهادی:</strong> ${h.tests.join('، ')}</div>
            </div>`).join('');
    }

    // VBG disclaimer
    const vbgNote = isVBG ? `<div class="vbg-section">
        <div class="vbg-section-title"><i class="fas fa-info-circle"></i> نکته VBG</div>
        <div class="vbg-comp-text">مقادیر وریدی (VBG) تقریباً ۰.۰۳–۰.۰۵ واحد کمتر از pH شریانی هستند. pCO₂ وریدی معمولاً ۶–۸ mmHg بالاتر است. HCO₃ وریدی معادل شریانی است. برای ارزیابی دقیق اکسیژناسیون از ABG استفاده کنید.</div>
    </div>` : '';

    return `
        <div class="vbg-primary ${bannerClass}">
            <div class="vbg-primary-label">${primaryTitle}</div>
            <div class="vbg-primary-severity">${sevBadge}</div>
        </div>

        <div class="vbg-section">
            <div class="vbg-section-title"><i class="fas fa-flask"></i> مقادیر</div>
            <div class="vbg-row"><span>pH</span><strong class="${phClass}">${_vbgFmt(pH,2)}</strong></div>
            <div class="vbg-row"><span>pCO₂</span><strong class="${co2Class}">${_vbgFmt(pco2,1)} mmHg</strong></div>
            <div class="vbg-row"><span>HCO₃⁻</span><strong class="${hco3Class}">${_vbgFmt(hco3,1)} mEq/L</strong></div>
            ${!isNaN(be) ? `<div class="vbg-row"><span>Base Excess</span><strong class="${beClass}">${be >= 0 ? '+' : ''}${_vbgFmt(be,1)}</strong></div>` : ''}
        </div>

        ${compRows ? `<div class="vbg-section">
            <div class="vbg-section-title"><i class="fas fa-arrows-left-right"></i> تحلیل جبران</div>
            ${compRows}
        </div>` : ''}

        ${agHTML}
        ${sevHTML}
        ${hintsHTML}
        ${vbgNote}

        <div class="vbg-disclaimer"><i class="fas fa-user-doctor"></i> این تفسیر ابزار کمکی آموزشی است — تصمیم بالینی نهایی با پزشک است.</div>
    `;
}

// ── Main entry point ──────────────────────────────────────────────────────────
window.interpretVBG = function() {
    const pH   = PersianNumbers.parseNumber(document.getElementById('vbgPH')?.value);
    const pco2 = PersianNumbers.parseNumber(document.getElementById('vbgPCO2')?.value);
    const hco3 = PersianNumbers.parseNumber(document.getElementById('vbgHCO3')?.value);
    const beRaw = document.getElementById('vbgBE')?.value || '';
    const be   = beRaw !== '' ? PersianNumbers.parseNumber(beRaw) : NaN;
    const na   = PersianNumbers.parseNumber(document.getElementById('vbgNa')?.value);
    const cl   = PersianNumbers.parseNumber(document.getElementById('vbgCl')?.value);
    const alb  = PersianNumbers.parseNumber(document.getElementById('vbgAlbumin')?.value);
    const resultEl = document.getElementById('vbgResult');
    // Detect mode from checkbox if present, else assume VBG
    const isVBG = !document.getElementById('vbgModeABG')?.checked;

    if (isNaN(pH)   || pH < 6.5  || pH > 8.0)  { showToast('خطا','pH را بین 6.5 و 8.0 وارد کنید','error'); return; }
    if (isNaN(pco2) || pco2 < 5  || pco2 > 150) { showToast('خطا','pCO₂ را وارد کنید','error'); return; }
    if (isNaN(hco3) || hco3 < 1  || hco3 > 60)  { showToast('خطا','HCO₃ را وارد کنید','error'); return; }

    const phStatus  = vbgStep1(pH);
    const vars      = vbgStep2(pco2, hco3);
    const disorders = vbgStep3(phStatus, pco2, hco3, vars);
    const agResult  = vbgAnionGap(na, cl, hco3, alb);
    const severity  = vbgSeverity(pH, pco2, hco3);
    const hints     = vbgClinicalHints(disorders, agResult);

    resultEl.innerHTML = vbgBuildHTML(pH, pco2, hco3, be, disorders, agResult, severity, hints, isVBG);
    resultEl.style.display = 'block';
    haptic(40);
    setTimeout(() => resultEl.scrollIntoView({ behavior:'smooth', block:'nearest' }), 100);
};
