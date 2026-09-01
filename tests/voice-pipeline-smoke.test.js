'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function makeStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); }
    };
}

function toLatinDigits(value) {
    const fa = '۰۱۲۳۴۵۶۷۸۹';
    const ar = '٠١٢٣٤٥٦٧٨٩';
    return String(value || '')
        .replace(/[۰-۹]/g, c => String(fa.indexOf(c)))
        .replace(/[٠-٩]/g, c => String(ar.indexOf(c)));
}

function testCommandRouting() {
    const events = [];
    const storage = makeStorage();
    const elements = {
        bmiWeight: { value: '' },
        bmiHeight: { value: '' },
        bmiResult: { textContent: '18.9' },
        settingsModal: { classList: { add(value) { events.push({ kind: 'settings-class', value }); } } }
    };
    const window = {
        VoiceUI: {
            showResult(message, type) {
                events.push({ kind: 'result', message, type });
            },
            showConfirmation(message, onConfirm, onCancel) {
                events.push({ kind: 'confirmation', message, onConfirm, onCancel });
            },
            recordHistory(label, replay) {
                events.push({ kind: 'voice-history', label, replay });
            },
            appendTip() {}
        }
    };

    const dbContext = { window: {} };
    vm.createContext(dbContext);
    vm.runInContext(read('drugDatabase.js') + '\nthis.__drugDatabase = drugDatabase;', dbContext, { filename: 'drugDatabase.js' });
    const drugDatabase = JSON.parse(JSON.stringify(dbContext.__drugDatabase));
    // Vancomycin is currently a Y-site reference medicine rather than a main
    // calculator card, but keeping it in this routing harness verifies the
    // established two-drug compatibility phrase as well.
    drugDatabase.vancomycin = {
        persianName: 'وانکومایسین', englishName: 'Vancomycin', alternativeNames: []
    };

    const context = {
        window,
        console,
        Set,
        Map,
        Date,
        Math,
        JSON,
        RegExp,
        localStorage: storage,
        document: {
            body: { classList: { add() {} } },
            getElementById(id) { return elements[id] || null; },
            querySelectorAll() { return []; }
        },
        DOM: { settingsModal: elements.settingsModal },
        PersianNumbers: { toLatin: toLatinDigits },
        drugDatabase,
        AppState: { settings: {} },
        saveSettings() {},
        applyThemeMode() {},
        applySettings() {},
        calculateBMI() {
            events.push({ kind: 'bmi-calculation', weight: Number(elements.bmiWeight.value), height: Number(elements.bmiHeight.value) });
        },
        selectDrug(id) { events.push({ kind: 'drug-selected', id }); },
        switchTab(tab) { events.push({ kind: 'tab', tab }); },
        setTimeout(fn) { events.push({ kind: 'deferred', fn }); return events.length; },
        clearTimeout() {}
    };
    window.window = window;
    window.drugDatabase = drugDatabase;
    vm.createContext(context);
    vm.runInContext(read('voice-commands.js'), context, { filename: 'voice-commands.js' });

    function run(phrase) {
        events.length = 0;
        window.VoiceCommands.process(phrase);
        return events.slice();
    }

    let result = run('بی‌ام‌آی وزن ۷۰ قد ۱۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BMI')),
        'BMI should require confirmation');

    result = run('بي ام آي وزن ۷۰ قد ۱۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BMI')),
        'Arabic/Persian letter variants should normalize');

    result = run('بی ام عای وزن ۷۰ قد ۱۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BMI')),
        'common Persian ASR spelling of spoken BMI should normalize');

    result = run('محاسبه بی MI');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BMI')),
        'mixed Persian/Latin Rizeh transcript "بی MI" should route to BMI');

    result = run('شاخص توده بدنی وزن ۷۰ قد ۱۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BMI')),
        'natural Persian BMI name should route to BMI');

    result = run('جی سی اس ۴ ۵ ۶');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('GCS')),
        'spoken Persian GCS acronym must survive number conversion');

    result = run('گلاسکو ۴ ۵ ۶');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('GCS')),
        'natural Persian GCS name should route to GCS');

    result = run('کلیرانس کراتینین سن ۴۵ وزن ۶۰ زن');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('جنسیت: زن') && !e.message.includes('جنسیت: مرد')),
        'female CrCl phrasing must never be classified as male');

    result = run('محاسبه درصد سوخت');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('درصد سوختگی')),
        'clipped ASR transcript for burns must route to burns');
    assert(!result.some(e => e.kind === 'confirmation' && e.message.includes('غلظت درصدی')),
        'burns phrase must never route to percentage concentration');

    result = run('محاسبه درصد سوختگی');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('درصد سوختگی')),
        'complete burns phrase should route to burns');

    result = run('چندفزیون هپار');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'observed clipped heparin infusion transcript should route to the drug calculator');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو: هپارین') && !e.message.includes('چندفزیون هپار')),
        'clinical confirmation must show the canonical drug instead of fuzzy ASR text');

    result = run('هموزیان هپاری');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'new observed heparin substitution should route to the drug calculator');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو: هپارین') && !e.message.includes('هموزیان هپاری')),
        'heparin recovery must keep fuzzy transcript text out of the visible confirmation');

    result = run('من فزیون هپاری');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'latest observed split heparin substitution should route to the drug calculator');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو: هپارین') && !e.message.includes('من فزیون هپاری')),
        'split heparin recovery must show the resolved drug only');

    result = run('چندفزیان انسولین رگو');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'observed clipped regular-insulin infusion transcript should route to the drug calculator');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو: انسولین رگولار') && !e.message.includes('چندفزیان')),
        'regular-insulin recovery must show the canonical drug only');

    result = run('انفوزیون انسولین رگووللا');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'observed regular-insulin qualifier should route to the drug calculator');

    result = run('امفزیان انسولین رگولایژ');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'latest observed regular-insulin substitutions should route to the drug calculator');

    result = run('امفزیونتی انجی');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'observed joined TNG infusion transcript should route to nitroglycerin');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو: نیتروگلیسیرین') &&
        e.message.includes('روش: پمپ انفوزیون') && !e.message.includes('امفزیونتی انجی')),
        'TNG recovery must confirm the canonical drug and method without fuzzy decoder text');

    const observedRizehDrugCases = [
        ['امپوزیان میادوللان دو می گرم در ساعت', 'میدازولام', '۲ میلی‌گرم در ساعت'],
        ['امفزیون فانیل صد میکروگرم در ساعت', 'فنتانیل', '۱۰۰ میکروگرم در ساعت'],
        ['امپزیون فزماید چهار میلیگرم در دقیقه', 'فوروزماید', '۴ میلی‌گرم در دقیقه'],
        ['امزیون فزماید چهار می میرم در دقیقا با میکروس', 'فوروزماید', '۴ میلی‌گرم در دقیقه'],
        ['امپزیون اکتوت تاید پنجاه میترلو در ساعت', 'اکترئوتاید', '۵۰ میکروگرم در ساعت'],
        ['همپزیان دوپامامی', 'دوپامین', null],
        ['امپزیون آامیاد داران', 'آمیودارون', null],
        ['امپزیون عامیه دارون', 'آمیودارون', null],
        ['من پزیون پ و پروزو', 'پنتوپرازول', null],
        ['امفوزیان پتو پروراول', 'پنتوپرازول', null]
    ];
    observedRizehDrugCases.forEach(function ([phrase, drugName, dosePhrase]) {
        result = run(phrase);
        const confirmation = result.find(e => e.kind === 'confirmation');
        assert(confirmation && confirmation.message.includes('دارو: ' + drugName) &&
            confirmation.message.includes('روش: پمپ انفوزیون'),
            'observed Rizeh substitution must resolve to canonical infusion drug: ' + phrase + ' :: ' + JSON.stringify(result));
        if (dosePhrase) assert(confirmation.message.includes('دوز/دستور: ' + dosePhrase),
            'observed dose and rate must survive canonical recovery: ' + phrase + ' :: ' + confirmation.message);
        confirmation.onConfirm();
        assert(events.some(e => e.kind === 'voice-history' && e.label.includes(drugName) && !e.label.includes(phrase)),
            'history must store the canonical completed action, not fuzzy ASR text: ' + phrase);
    });

    ['میکروست فوروزمید', 'میکروس فوروزمید', 'میکروست فروسماید', 'ماکروست فوروزماید'].forEach(function (phrase) {
        result = run(phrase);
        const confirmation = result.find(e => e.kind === 'confirmation');
        assert(confirmation && confirmation.message.includes('دارو: فوروزماید') &&
            confirmation.message.includes('روش: پمپ انفوزیون'),
            `micro/macro-set wording must recover Furosemide and explicitly select the infusion pump: ${phrase}`);
    });

    Object.entries(drugDatabase).forEach(function ([id, drug]) {
        if (id === 'vancomycin') return;
        result = run('انفوزیون ' + drug.persianName);
        assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز') && e.message.includes('دارو: ' + drug.persianName)),
            'every calculator drug must route from its displayed Persian name: ' + id + ' :: ' + JSON.stringify(result));
    });

    ['انفوزیون فروزماید', 'دوز نور اپی نفرین', 'تزریق فنتانل', 'انفوزیون میدازولم'].forEach(function (phrase) {
        result = run(phrase);
        assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
            'common medical ASR substitution should route safely: ' + phrase + ' :: ' + JSON.stringify(result));
    });

    result = run('تنظیماتو باز کن');
    assert(result.some(e => e.kind === 'result' && e.message.includes('تنظیمات باز شد')),
        'colloquial settings request should open Settings directly');

    result = run('چه کارهایی بلدی؟');
    assert(result.some(e => e.kind === 'result' && e.type === 'info' && e.message.includes('محاسبه‌گر دارو')) &&
        !result.some(e => e.kind === 'confirmation'),
        'capabilities prompt should return the assistant guide without clinical confirmation');

    result = run('یه مای برای مریضی که قدش صد و هفتاد و دو و وزنش پنجاه و شش کیلوه');
    const colloquialBmiConfirmation = result.find(e => e.kind === 'confirmation' && e.message.includes('BMI'));
    assert(colloquialBmiConfirmation, 'observed BMI substitution should route with height and weight');
    assert(colloquialBmiConfirmation.message.includes('وزن:') && colloquialBmiConfirmation.message.includes('قد:') &&
        !colloquialBmiConfirmation.message.includes('یه مای'),
        'BMI confirmation must show interpreted patient values without fuzzy ASR wording');
    colloquialBmiConfirmation.onConfirm();
    assert(events.some(e => e.kind === 'bmi-calculation' && e.weight === 56 && e.height === 172),
        'colloquial BMI command must apply height 172 and weight 56');
    assert(elements.bmiWeight.value === 56 && elements.bmiHeight.value === 172,
        'confirmed BMI values must remain visible in the BMI card fields');

    result = run('شاخص توده بدنی');
    const bmiConfirmation = result.find(e => e.kind === 'confirmation' && e.message.includes('BMI'));
    assert(bmiConfirmation, 'recognized BMI without values should still ask for confirmation');
    bmiConfirmation.onConfirm();
    assert(events.some(e => e.kind === 'tab' && e.tab === 'tools'),
        'confirmed BMI command must open the tools tab even when values are missing');

    result = run('مقیاس برادن');
    const bradenConfirmation = result.find(e => e.kind === 'confirmation' && e.message.includes('Braden'));
    assert(bradenConfirmation, 'recognized Braden command should ask for confirmation');
    bradenConfirmation.onConfirm();
    assert(events.some(e => e.kind === 'tab' && e.tab === 'tools'),
        'confirmed Braden command must open the tools tab');
    assert(events.some(e => e.kind === 'deferred'),
        'confirmed Braden command must schedule its calculator accordion to open');

    result = run('خطر سقوط کودک');
    const humptyConfirmation = result.find(e => e.kind === 'confirmation' && e.message.includes('Humpty Dumpty'));
    assert(humptyConfirmation && !humptyConfirmation.message.includes('Morse'),
        'pediatric fall-risk wording must route to Humpty Dumpty instead of adult Morse');
    humptyConfirmation.onConfirm();
    assert(events.some(e => e.kind === 'tab' && e.tab === 'tools') && events.some(e => e.kind === 'deferred'),
        'confirmed Humpty Dumpty command must open its tools accordion');

    result = run('هامپی دامپی ۴ ۲ ۴ ۳ ۴ ۳ ۳');
    const scoredHumptyConfirmation = result.find(e => e.kind === 'confirmation' && e.message.includes('Humpty Dumpty'));
    assert(scoredHumptyConfirmation && scoredHumptyConfirmation.message.includes('امتیازهای Humpty Dumpty'),
        'seven spoken Humpty Dumpty scores must appear in the clinical confirmation');

    const naturalCommandCases = [
        ['مساحت سطح بدن', 'BSA'], ['وزن مطلوب بیمار', 'وزن ایده‌آل'],
        ['کلیرنس کراتینین', 'کلیرانس کراتینین'], ['سرم چند قطره در دقیقه', 'سرعت قطره'],
        ['سطح هوشیاری گلاسکو', 'GCS'], ['میزان سدیشن ریچموند', 'RASS'],
        ['ریسک زخم بستر', 'Braden'], ['ریسک سقوط بیمار', 'Morse'], ['هامپتی دامپتی', 'Humpty Dumpty'],
        ['وسعت سوختگی', 'درصد سوختگی'], ['کپسول اکسیژن چقدر میمونه', 'مدت اکسیژن'],
        ['تفسیر ای بی جی', 'گاز خون'], ['حجم جاری ونتیلاتور', 'ونتیلاتور'],
        ['نیاز کالری بیمار', 'تغذیه'], ['تبدیل الکترولیت', 'تبدیل الکترولیت'],
        ['محاسبه غلظت درصدی', 'غلظت درصدی'], ['مبدل واحد', 'تبدیل واحد'],
        ['تبدیل دما', 'تبدیل دما'], ['تبدیل وزن', 'تبدیل وزن'],
        ['مبدل فشار', 'تبدیل فشار'], ['سازگاری هپارین و وانکومایسین', 'سازگاری Y-Site']
    ];
    naturalCommandCases.forEach(([phrase, expectedLabel]) => {
        const routed = run(phrase);
        assert(routed.some(e => e.kind === 'confirmation' && e.message.includes(expectedLabel)),
            `natural command "${phrase}" should route to ${expectedLabel}; got ${JSON.stringify(routed)}`);
    });

    result = run('چه خبر');
    assert(result.some(e => e.kind === 'result' && e.type === 'success') && !result.some(e => e.kind === 'confirmation'),
        'younger-user small talk should receive a friendly non-clinical response');
    ['سالا امهال اچتوره', 'سالام حالت چتوره', 'سالام هل چیث ره', 'حو بی', 'خیده هستا', 'گیدگستا'].forEach(phrase => {
        result = run(phrase);
        assert(result.some(e => e.kind === 'result' && e.type === 'success') && !result.some(e => e.kind === 'confirmation'),
            `observed Whisper greeting variant should receive a friendly response: ${phrase} :: ${JSON.stringify(result)}`);
    });
    result = run('استرس دارم');
    assert(result.some(e => e.kind === 'result' && e.type === 'success') && !result.some(e => e.kind === 'confirmation'),
        'standalone stress chat should not be confused with nutrition');
    ['گرسنه', 'گشنم', 'گرسنه ام'].forEach(phrase => {
        const hungerReply = run(phrase);
        assert(hungerReply.some(e => e.kind === 'result' && e.type === 'success' &&
            (e.message.includes('بخوری') || e.message.includes('خوراکی'))) &&
            !hungerReply.some(e => e.kind === 'confirmation'),
            `common hunger phrase should receive a warm non-clinical reply: ${phrase}`);
    });
    ['گرشنه ام', 'گشنما'].forEach(phrase => {
        const hungerReply = run(phrase);
        assert(hungerReply.some(e => e.kind === 'result' && e.type === 'success') &&
            !hungerReply.some(e => e.kind === 'confirmation'),
            `one-character phone-ASR hunger distortion should stay in non-clinical chat: ${phrase}`);
    });
    ['تشنه', 'تشنم', 'تشنه ام'].forEach(phrase => {
        const thirstReply = run(phrase);
        assert(thirstReply.some(e => e.kind === 'result' && e.type === 'success' &&
            (e.message.includes('آب بخوری') || e.message.includes('لیوان آب'))) &&
            !thirstReply.some(e => e.kind === 'confirmation'),
            `common thirst phrase should receive a warm non-clinical reply: ${phrase}`);
    });
    result = run('سرم خیلی شلوغه');
    assert(result.some(e => e.kind === 'result' && e.type === 'success' &&
        (e.message.includes('سرت شلوغه') || e.message.includes('واقعاً سنگینه'))) &&
        !result.some(e => e.kind === 'confirmation'),
        'busy-shift chat should receive an empathetic, useful reply instead of a bare acknowledgement');
    ['سازندت کیه', 'کی تورو ساخته'].forEach(phrase => {
        const creatorReply = run(phrase);
        assert(creatorReply.some(e => e.kind === 'result' && e.type === 'success' &&
            e.message.includes('محمدمهدی تقوی') && e.message.includes('ارتباط با سازنده')) &&
            !creatorReply.some(e => e.kind === 'confirmation'),
            `natural creator question should identify the nurse-developer warmly: ${phrase}`);
    });
    ['سازندت کبه', 'کی تورو سخته'].forEach(phrase => {
        const creatorReply = run(phrase);
        assert(creatorReply.some(e => e.kind === 'result' && e.message.includes('محمدمهدی تقوی')) &&
            !creatorReply.some(e => e.kind === 'confirmation'),
            `one-character phone-ASR creator distortion should identify the creator: ${phrase}`);
    });
    run('سازندت کیه');
    result = run('آره');
    assert(result.some(e => e.kind === 'settings-class' && e.value === 'active') &&
        result.some(e => e.kind === 'result' && e.message.includes('تلگرام')),
        'a short affirmative follow-up should reveal the creator contact in Settings');
    result = run('ارتباط با سازنده');
    assert(result.some(e => e.kind === 'settings-class' && e.value === 'active') &&
        result.some(e => e.kind === 'result' && e.message.includes('تلگرام')),
        'creator contact request should open the existing Telegram contact in Settings');
    result = run('خوبه محاسبه برادن');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('Braden')),
        'social wording appended to a clinical request must not hijack it');
    result = run('عبارت نامفهوم آزمایشی');
    assert(result.some(e => e.kind === 'result' && e.type === 'error'),
        'unknown speech must fail honestly instead of using generic filler');
    result = run('فشار بیمار');
    assert(!result.some(e => e.kind === 'confirmation' && e.message.includes('تبدیل فشار')),
        'bare patient pressure wording must not open unit conversion');

    result = run('قطره ۵۰۰ ml در ۸ ساعت');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('سرعت قطره')),
        'drip calculation should require confirmation');

    result = run('هپارین ۱۲ units وزن ۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'drug dose should require confirmation');

    result = run('سطح بدن وزن ۷۰ قد ۱۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BSA')),
        'explicit BSA should route to BSA');

    result = run('وزن ۷۰ قد ۱۷۰');
    assert(!result.some(e => e.kind === 'confirmation'),
        'ambiguous BMI/BSA input must not execute');
    assert(result.some(e => e.kind === 'result' && e.message.includes('BMI یا BSA')),
        'ambiguous body measurement should ask for clarification');

    result = run('ساعت ۸');
    assert(!result.some(e => e.kind === 'confirmation'),
        'generic time word must not route to drip');

    result = run('به ۲۰');
    assert(!result.some(e => e.kind === 'confirmation'),
        'generic Persian preposition must not route to conversion');

    result = run('دارو');
    assert(result.some(e => e.kind === 'tab' && e.tab === 'drugs'),
        'safe drug-library navigation should run without confirmation');
}

function testDeploymentWiring() {
    const workflow = read('.github/workflows/pages-sherpa-koochik.yml');
    const serviceWorker = read('service-worker.js');
    const index = read('index.html');
    const manifest = read('manifest.json');
    const script = read('script.js');
    const voiceEngine = read('voice-recognition.js');
    const voiceUi = read('voice-ui.js');
    const voiceCommands = read('voice-commands.js');
    const voiceAssistantCss = read('voice-assistant.css');
    const styleCss = read('style.css');

    assert(workflow.includes('shenava-rizeh-v1.0-non-streaming-int8'),
        'deployment workflow must download Rizeh');
    assert(!workflow.includes('shenava-koochik-v1.0-non-streaming-int8'),
        'deployment workflow must not download the old Koochik model');
    assert(workflow.includes('f2b9251cc3ceb177bc5e55ddd4114536c3bb61d3'),
        'deployment workflow must pin the reviewed Rizeh revision');
    assert(workflow.includes('RIZEH_MODEL_SHA256') && workflow.includes('sha256sum --check --strict'),
        'deployment workflow must verify the Rizeh payload');
    assert(workflow.includes('WASM_INITIAL_MEMORY_MB: "256"'),
        'mobile build must not reserve sherpa-onnx default 512 MB at startup');
    assert(workflow.includes("--exclude 'icons/vosk-model-small-fa-0.5.tar.gz'"),
        'the obsolete Vosk archive must not be shipped in the Pages site');
    assert(serviceWorker.includes('FoxiMed_Model_Rizeh_v1_nonstreaming_int8_f2b9251'),
        'service worker must use a cache namespace tied to the pinned Rizeh revision');
    assert(serviceWorker.includes('koochik-worker.js?v=35'),
        'service worker must precache the v35 Rizeh worker URL');
    assert(read('koochik-asr.js').includes("koochik-worker.js?v=35"),
        'voice adapter must instantiate the v35 Rizeh worker URL');
    assert(index.includes('service-worker.js?v=45'),
        'page must register the v45 service worker');
    assert(script.includes("const APP_VERSION = '5.2.0'") &&
        index.includes('نسخه 5.2.0') && manifest.includes('"version": "5.2.0"') &&
        serviceWorker.includes("const CACHE_NAME = 'FoxiMed_v5.2.0'"),
        'all public release surfaces must identify the Version 5.2 release consistently');
    assert(script.includes("'5.2.0': [") && script.includes('HAS_PRE_V5_INSTALL') &&
        script.includes("'sw_first_install'") && script.includes('if (HAS_PRE_V5_INSTALL)'),
        'returning users must see the current Version 5 release summary once');
    assert(script.includes("const RELEASE_NOTES_REVISION = '5.2.0-major-humpty'") &&
        script.includes('setLastSeenVersion(RELEASE_NOTES_REVISION)') &&
        script.includes('lastSeen !== RELEASE_NOTES_REVISION'),
        'users who saw the brief 5.2 maintenance note must receive the restored major changelog once');
    const v52Changelog = script.slice(script.indexOf("'5.2.0': ["), script.indexOf("'5.1.0': ["));
    assert(v52Changelog.includes('دستیار هوشمند فارسی با فرمان صوتی آفلاین') &&
        v52Changelog.includes('پوستهٔ رنگی جدید «DreamFire»') &&
        v52Changelog.includes('مقیاس هامپی دامپی برای ارزیابی خطر سقوط اطفال') &&
        v52Changelog.includes('پیش‌فرض‌های قابل تنظیم برای پمپ') &&
        v52Changelog.includes('بهبود دقت و پایداری'),
        'Version 5.2 must present the major Version 5 assistant, theme, Humpty, defaults and reliability upgrade');
    assert(voiceAssistantCss.includes('circle at 50% 48%') &&
        voiceAssistantCss.includes('rgba(124, 45, 18, 0.20)') &&
        voiceAssistantCss.includes('rgba(251, 146, 60, 0) 88%') &&
        voiceAssistantCss.includes('.dark-mode .voice-orb-container::before'),
        'light mode must use a darker warm core that fades into the fox halo without changing dark mode');
    const desktopCss = styleCss.slice(styleCss.indexOf('@media (min-width: 769px)'), styleCss.indexOf('@media (min-width: 1200px)'));
    assert(desktopCss.includes('.drug-sidebar') && desktopCss.includes('overflow: hidden') &&
        desktopCss.includes('.drug-quick-select') && desktopCss.includes('min-height: 0') &&
        desktopCss.includes('.drug-scroll-container') && desktopCss.includes('overflow-y: auto'),
        'desktop drug cards must have one bounded scroll owner so the mouse wheel works over the full list');
    assert(styleCss.includes('.header-fox-mark {\n    width: 58px;\n    height: 58px;') &&
        styleCss.includes('.header-fox-mark {\n        width: 50px;\n        height: 50px;'),
        'the header fox must remain prominent within the existing desktop and mobile header heights');
    assert(index.includes('Rizeh — آفلاین') && !index.includes('voiceRecognitionModeSelect') && !index.includes('whisper-base'),
        'Settings must present one clear Rizeh status instead of experimental model choices');
    assert(index.includes('id="defaultInfusionMethodSelect"') &&
        index.includes('id="defaultSyringeVolumeSelect"') &&
        index.includes('id="defaultInfusionVolumeSelect"') &&
        script.includes('getPreferredSolutionVolume') && script.includes('syncCalculatorMethodButtons'),
        'Settings must persist ward-specific pump and solution-volume defaults');
    assert(!index.includes('whisper-asr.js') && !serviceWorker.includes('whisper-worker.js') &&
        !serviceWorker.includes('voice-engine-policy.js'),
        'the shipped app shell must not load or cache removed Whisper paths');
    assert(voiceEngine.includes("return 'rizeh';") && !voiceEngine.includes('WhisperASR'),
        'voice recognition must use the single Rizeh backend');
    assert(!script.includes('VoiceEngine.releaseModel'),
        'tab changes must keep the loaded voice model warm');
    assert(voiceEngine.includes("emit('decoding'") && voiceUi.includes("VoiceEngine.on('decoding'"),
        'engine and UI must expose the listening-to-decoding lifecycle transition');
    assert(!voiceUi.includes('setTranscript(') && !voiceUi.includes("on('interim'") && !index.includes('id="voiceTranscript"') &&
        voiceUi.includes("setStatus('', 'processing')") && voiceUi.includes("setAttribute('aria-label', 'در حال تبدیل صدا به متن')") &&
        voiceAssistantCss.includes('.voice-status.processing::before') && voiceAssistantCss.includes('voiceStatusSpin'),
        'listening and decoding must use accessible animation without exposing fuzzy raw transcripts');
    assert(!index.includes('id="voiceModelFox"') && voiceUi.includes('setModelFoxProgress(percent, state)') &&
        voiceUi.includes("setProperty('--model-progress'") &&
        voiceAssistantCss.includes('.voice-orb-container.is-loading-model .voice-fox-mark::after'),
        'model download must fill the existing main fox from the real overall progress without duplicating the mascot');
    assert(index.includes('id="loadingFox"') && !index.includes('class="loading-logo-img"') &&
        !index.includes('class="loading-tip') && script.includes("setProperty('--loading-progress'") &&
        read('style.css').includes('.loading-fox-fill') && read('style.css').includes('width: 220px'),
        'startup must use the lightweight premium fox treatment without rotating emoji tips');
    const loadingMarkup = index.slice(index.indexOf('<!-- Loading Screen -->'), index.indexOf('<!-- PWA Install Guide Modal -->'));
    assert(loadingMarkup.includes('دستیار بالینی هوشمند پرستاران') && !/ICU/i.test(loadingMarkup),
        'loading screen must preserve the current all-nursing tagline without ICU-specific wording');
    assert(voiceAssistantCss.includes('order: 20') && voiceAssistantCss.includes('bottom: calc(100% + 6px)') &&
        voiceAssistantCss.includes('transform: translateY(-4px)') && voiceCommands.includes("return lines.join(' · ');"),
        'voice input must stay at the bottom while compact confirmations keep the fox nearly stationary');
    assert(index.includes('class="header-fox-mark"') && !index.includes('<div class="logo"><i class="fas fa-syringe"') &&
        read('style.css').includes('.dark-mode .header-fox-mark') &&
        read('style.css').includes("fox-mark-clean-mask.png") && serviceWorker.includes('fox-mark-clean-mask.png'),
        'top bar must use a compact high-contrast fox mark instead of the generic syringe icon');
    assert(index.includes('tutorial-fox-icon') && !index.includes('style="background:var(--gradient-primary)"><i class="fas fa-syringe"') &&
        index.includes('id="voiceCapabilitiesBtn"') && index.includes('چه کارهایی بلدی؟') &&
        voiceUi.includes("'capabilities'"),
        'welcome, tutorial and assistant UI must introduce the fox and expose assistant capabilities');
    assert(voiceAssistantCss.includes('min-height: 100%;') &&
        voiceAssistantCss.includes('flex: 1 1 270px;') &&
        voiceAssistantCss.includes('.voice-orb-zone { flex: 0 0 auto; min-height: 0; }'),
        'assistant layout must use tall-screen space while preserving compact short-phone behavior');
    assert(read('style.css').includes('width: 220px;') &&
        read('style.css').includes('.dark-mode .logo {\n    background: transparent;') &&
        read('style.css').includes('.tutorial-fox-mark {') && read('style.css').includes('width: 112px;'),
        'startup and tutorial foxes must be dominant while the header fox remains unboxed');
    assert(index.includes('id="tutorialSpotlight"') && index.includes('id="tutorialCoachArrow"') &&
        index.includes('data-tour-target=') && script.includes('function positionCoachMark()') &&
        script.includes('function showTourTab(tabName)') && read('style.css').includes('0 0 0 9999px'),
        'onboarding must spotlight and point to real controls instead of showing a static diagram');
    assert(script.includes('without calling switchTab()') && script.includes('showTourTab(slides[current].dataset.tourTab'),
        'previewing the assistant during onboarding must not preload its large offline model');
    assert(voiceAssistantCss.includes('.voice-container.stage-locked .voice-orb-zone') &&
        voiceAssistantCss.includes('max-height: min(24vh, 176px)') &&
        voiceUi.includes('function stabilizeLayout()') && voiceUi.includes("'--voice-stable-stage-height'"),
        'assistant replies must stay compact below a fixed fox stage without moving the mascot');
    assert(voiceCommands.includes('می‌تونم محاسبه‌گر دارو') && !voiceCommands.includes('می‌توانم محاسبه‌گر دارو'),
        'assistant capability replies must use a natural colloquial Persian voice');
    assert(voiceUi.includes('window.VoiceEngine.isActive()) return'),
        'a stale result timer must never reset an active microphone to idle');
    assert(voiceUi.includes("p.status === 'retrying-network'"),
        'the model dialog must explain connection retries instead of looking stalled');
    assert(voiceEngine.includes("console.log('[KoochikASR] FINAL decode result:'") && voiceEngine.includes("engine.audioStats ? engine.audioStats()"),
        'voice diagnostics must name Rizeh and report available audio levels');
    assert(voiceCommands.includes('buildConfirmationMessage') && !voiceCommands.includes("'شنیده شد: «'"),
        'clinical confirmation must show canonical interpreted action and values rather than raw ASR text');
    assert(read('koochik-asr.js').includes('overallPercent') && voiceUi.includes('دانلود کلی'),
        'Rizeh and the shared UI must report rounded whole-model progress');
    assert(!voiceUi.includes('addToHistory(text)') && voiceUi.includes('recordHistory: recordHistory') &&
        voiceCommands.includes('recordCompletedAction(cmd, params)'),
        'assistant history must store canonical completed actions instead of raw ASR text');
    assert(index.includes('آماده‌سازی مدل صدا فقط هنگام استفاده'),
        'low-power description must match its real on-demand model behavior');
    assert(voiceEngine.includes('onlineFallbackAvailable: true') && voiceEngine.includes('startOnline: startOnline'),
        'offline failures must expose an explicit online retry');
    assert(voiceUi.includes('صدا برای تشخیص به سرویس مرورگر فرستاده می‌شه'),
        'online retry must disclose that speech leaves the device');
    assert(index.includes('voice-tap-hint') && index.includes('برای صحبت لمس کنید'),
        'voice mascot must visibly explain that it is the microphone control');
    assert(index.includes('id="toolsSearch"') && script.includes('setupToolsSearch()'),
        'tools tab must expose compact search');
    assert(!index.includes('chip-emoji') && index.includes('voice-chip-icon'),
        'assistant examples must use the clinical icon system');
    assert(!index.includes('voice-embers') && !voiceUi.includes('spawnEmbers'),
        'assistant must avoid decorative ember work');
    [
        'gcsAccordionItem', 'rassAccordionItem', 'bradenAccordionItem', 'morseAccordionItem', 'humptyAccordionItem',
        'oxygenAccordionItem', 'burnsAccordionItem', 'bmiAccordionItem', 'ysiteAccordionItem',
        'bsaAccordionItem', 'ibwAccordionItem', 'ventilatorAccordionItem', 'nutritionAccordionItem',
        'vbgAccordionItem', 'crclAccordionItem', 'dripAccordionItem', 'unitAccordionItem',
        'electrolyteAccordionItem', 'percentageAccordionItem', 'tempAccordionItem',
        'weightAccordionItem', 'pressureAccordionItem'
    ].forEach((accordionId) => {
        assert(index.includes(`id="${accordionId}"`) && read('voice-commands.js').includes(`accordion: '${accordionId}'`),
            `${accordionId} must have a voice navigation target`);
    });
    assert(index.includes('id="humptyAccordionBody"') && index.includes('خطر سقوط اطفال') &&
        script.includes('function setupHumptyDumpty()') && script.includes("result.level === 'high'") &&
        voiceCommands.includes('function handleHumptyVoice(params)') && voiceCommands.includes('params.humptyScores'),
        'Humpty Dumpty must expose the seven-domain pediatric calculator and voice workflow');
    assert(index.includes('id="namePrompt"') && index.includes('لطفاً نام خود را وارد کنید') &&
        !index.includes('id="namePromptLater"') && !index.includes('id="namePromptNever"') &&
        script.includes("const USER_NAME_CAPTURE_VERSION = '5.1'") &&
        script.includes("localStorage.removeItem('userName')") && script.includes('if (captureComplete()) return'),
        'Version 5 must require one fresh name entry, including from users with an older stored name');
    assert(script.includes("localStorage.setItem('userName', cleanName)") &&
        script.includes('USER_NAME_CAPTURE_VERSION_KEY, USER_NAME_CAPTURE_VERSION'),
        'profile name and its completed Version 5 consent marker must remain device-local');
    assert(script.includes('function isHediyehName(name)') &&
        script.includes('هدیه|هدی|هدو') && script.includes('hedi(?:e|eh|ye|yeh)?') &&
        script.includes('ممنونم، چه اسم قشنگی، مطمئنم خودتم مثل اسمت جذابی!'),
        'Persian and Latin Hediyeh variants must receive the requested personalized reply');
    assert(script.includes('سازگاری به غلظت، حلال، فرمولاسیون و زمان تماس وابسته است'),
        'Y-site matrix must disclose context dependence and require verification');
    assert(index.includes('calculation-core.js?v=35') && serviceWorker.includes('calculation-core.js?v=35'),
        'tested calculation core must be loaded and cached');
}

function testNamePersonalization() {
    const script = read('script.js');
    const start = script.indexOf('function normalizePersonalName(name)');
    const end = script.indexOf('function saveUserNameValue(name)');
    assert(start >= 0 && end > start, 'name matching helpers must be present');

    const context = {};
    vm.createContext(context);
    vm.runInContext(script.slice(start, end), context, { filename: 'name-personalization.js' });

    ['هدیه', 'هديه', 'هدی', 'هدو', 'Hedieh', 'Hediyeh', 'Hedie', 'Hediye', 'Hedy', 'Hedo', 'Hedoo', 'هدیه احمدی']
        .forEach((name) => assert.strictEqual(context.isHediyehName(name), true, `${name} must match Hediyeh`));
    ['هدایت', 'هادی', 'Hadieh', 'Hedwig']
        .forEach((name) => assert.strictEqual(context.isHediyehName(name), false, `${name} must not match Hediyeh`));
}

function testReverseInfusionMath() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(read('calculation-core.js'), context, { filename: 'calculation-core.js' });
    const reverse = context.window.FoxiCalcCore.reverseInfusionDose;

    // 4 mg / 250 mL at 6.25 mL/h = 100 mcg/h = 1.6667 mcg/min;
    // for 70 kg this is 0.02381 mcg/kg/min. The old UI returned 0.00002381.
    const norepinephrine = reverse({
        pumpRate: 6.25,
        totalDrug: 4,
        solutionVolume: 250,
        drugUnit: 'mg',
        doseUnit: 'mcg/kg/min',
        weight: 70
    });
    assert(Math.abs(norepinephrine - 0.0238095238) < 1e-10,
        'reverse catecholamine math must convert mg to mcg before /min and /kg');

    const nitroglycerin = reverse({
        pumpRate: 6,
        totalDrug: 5,
        solutionVolume: 100,
        drugUnit: 'mg',
        doseUnit: 'mcg/min'
    });
    assert(Math.abs(nitroglycerin - 5) < 1e-12,
        'reverse non-weight dose must convert 0.3 mg/h to 5 mcg/min');

    assert.throws(() => reverse({
        pumpRate: 6.25,
        totalDrug: 4,
        solutionVolume: 250,
        drugUnit: 'mg',
        doseUnit: 'mcg/kg/min'
    }), /weight-required/, 'weight-based reverse math must reject a missing weight');
}

function testHumptyDumptyMath() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(read('calculation-core.js'), context, { filename: 'calculation-core.js' });
    const risk = context.window.FoxiCalcCore.humptyDumptyRisk;

    assert.deepStrictEqual(JSON.parse(JSON.stringify(risk([1, 1, 1, 1, 1, 1, 1]))),
        { total: 7, level: 'low' }, 'minimum score 7 must be low risk');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(risk([1, 1, 1, 1, 3, 2, 3]))),
        { total: 12, level: 'high' }, 'score 12 must be the high-risk boundary');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(risk([4, 2, 4, 3, 4, 3, 3]))),
        { total: 23, level: 'high' }, 'maximum score 23 must remain valid and high risk');
    assert.throws(() => risk([4, 2, 4]), /invalid-humpty-dumpty-scores/,
        'incomplete pediatric fall scores must be rejected');
}

function makeWorkerLogicContext() {
    const context = {
        self: { postMessage() {} },
        console,
        performance: { now: () => 0 },
        Float32Array,
        Array,
        Number,
        Math,
        String,
        Promise,
        Error,
        Date
    };
    vm.createContext(context);
    vm.runInContext(read('koochik-worker.js'), context, { filename: 'koochik-worker.js' });
    return context;
}

function testWorkerSegmentationAndFrames() {
    const context = makeWorkerLogicContext();

    let detected = vm.runInContext(
        'resetSession();\n' +
        'capturedSamples = 640;\n' +
        'totalSeconds = 0.04;\n' +
        'processEnergy(new Float32Array(640).fill(0.04), {' +
        'sileroActiveNow: false, segmentReady: false});\n' +
        'energySpeechDetected;',
        context
    );
    assert.strictEqual(detected, false, 'two 20 ms frames are not enough to start speech');

    detected = vm.runInContext(
        'capturedSamples = 1280;\n' +
        'totalSeconds = 0.08;\n' +
        'processEnergy(new Float32Array(640).fill(0.04), {' +
        'sileroActiveNow: false, segmentReady: false});\n' +
        'energySpeechDetected;',
        context
    );
    assert.strictEqual(detected, true, 'four 20 ms frames should start speech');

    detected = vm.runInContext(
        'resetSession();\n' +
        'capturedSamples = 1280;\n' +
        'totalSeconds = 0.08;\n' +
        'processEnergy(new Float32Array(1280).fill(0.04), {' +
        'sileroActiveNow: false, segmentReady: false});\n' +
        'energySpeechDetected;',
        context
    );
    assert.strictEqual(detected, true,
        'speech start must be invariant to browser callback chunking');

    const selection = vm.runInContext(
        'resetSession();\n' +
        'detectedSegments = [new Float32Array(3200).fill(0.02)];\n' +
        'speechDetected = true;\n' +
        'var chosenForTest = chooseDecodePcm(new Float32Array(12000).fill(0.01));\n' +
        '({ source: chosenForTest.source, length: chosenForTest.pcm.length });',
        context
    );
    assert.strictEqual(selection.source, 'silero-segments',
        'final decoding should use the retained Silero segment');
    assert.strictEqual(selection.length, 3200,
        'the retained segment should remain the fallback without energy bounds');

    const contextualSelection = vm.runInContext(
        'resetSession();\n' +
        'detectedSegments = [new Float32Array(3200).fill(0.02)];\n' +
        'speechDetected = true; energySpeechDetected = true;\n' +
        'speechStartSample = 3200; lastVoiceSample = 11200;\n' +
        'var chosenContextForTest = chooseDecodePcm(new Float32Array(24000).fill(0.01));\n' +
        '({ source: chosenContextForTest.source, length: chosenContextForTest.pcm.length,' +
        ' start: chosenContextForTest.startSample, end: chosenContextForTest.endSample });',
        context
    );
    assert.strictEqual(contextualSelection.source, 'energy-context',
        'energy-bounded raw capture should preserve final medical syllables');
    assert.strictEqual(contextualSelection.start, 3200);
    assert.strictEqual(contextualSelection.end, 18400,
        'decode window should retain 450 ms after the last detected voice frame');
    assert.strictEqual(contextualSelection.length, 15200,
        'decode should use bounded context rather than the full capture');
}

async function testWorkerLifecycle() {
    const workers = [];

    class FakeWorker {
        constructor(url) {
            this.url = url;
            this.terminated = false;
            workers.push(this);
        }
        postMessage(message) {
            if (message.type === 'init') {
                queueMicrotask(() => {
                    if (!this.terminated && this.onmessage) {
                        this.onmessage({ data: { type: 'ready', build: 'test' } });
                    }
                });
            }
            if (message.type === 'reset') {
                queueMicrotask(() => {
                    if (!this.terminated && this.onmessage) {
                        this.onmessage({ data: { type: 'reset-done', requestId: message.requestId } });
                    }
                });
            }
        }
        terminate() {
            this.terminated = true;
        }
    }

    const window = { location: { href: 'https://example.test/index.html' } };
    const context = {
        window,
        navigator: {},
        Worker: FakeWorker,
        URL,
        DOMException,
        console,
        Map,
        Promise,
        Error,
        Float32Array,
        Date,
        queueMicrotask
    };
    vm.createContext(context);
    vm.runInContext(read('koochik-asr.js'), context, { filename: 'koochik-asr.js' });

    const first = await window.KoochikASR.load({ baseUrl: './sherpa-koochik/' });
    assert.strictEqual(workers.length, 1, 'first load should create one worker');
    await first.destroy();
    assert.strictEqual(workers[0].terminated, true,
        'destroy should terminate the Emscripten worker');

    const second = await window.KoochikASR.load({ baseUrl: './sherpa-koochik/' });
    assert.strictEqual(workers.length, 2,
        'load after destroy should create a fresh worker');
    assert.notStrictEqual(workers[0], workers[1]);

    workers[1].onerror({ message: 'simulated crash' });
    await assert.rejects(second.finalize(), /simulated crash/,
        'a worker crash should surface to the active engine');

    const third = await window.KoochikASR.load({ baseUrl: './sherpa-koochik/' });
    assert.strictEqual(workers.length, 3,
        'load after a worker crash should create a fresh worker');
    await third.destroy();
}

(async function main() {
    testCommandRouting();
    testDeploymentWiring();
    testNamePersonalization();
    testReverseInfusionMath();
    testHumptyDumptyMath();
    testWorkerSegmentationAndFrames();
    await testWorkerLifecycle();
    console.log('voice pipeline smoke tests: PASS');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
