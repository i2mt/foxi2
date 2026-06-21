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
// ENHANCED DRUG DATABASE - PROFESSIONAL MEDICAL EDITION
// ============================================
const drugDatabase = {
    heparin: {
        id: 'heparin',
        persianName: 'هپارین',
        englishName: 'Heparin Sodium',
        alternativeNames: ['هپارین سدیم', 'Heparin', 'Hepflush'],
        icon: 'fas fa-tint',
        color: '#667eea',
        category: 'Anticoagulant',
        defaultAmpoules: 2,
        ampouleOptions: [
            { strength: 5000, unit: 'units', volume: 1, label: '5000 Units in 1 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'units/h',
        weightBased: { 
            active: true, 
            unit: 'units/kg/h', 
            typical: 12,
            range: { min: 10, max: 20 },
            defaultUseWeight: false,
            defaultWeight: 70
        },
        typicalDoseRange: { min: 500, max: 2000, unit: 'units/h' },
        maxSafeConcentration: '200 units/mL',
        solutionType: ['N.S', 'D5W'],
        ySiteCompatibilities: {
            compatible: [
                'مورفین (Morphine)',
                'فنتانیل (Fentanyl)',
                'دوپامین (Dopamine)',
                'میدازولام (Midazolam)',
                'پروپوفول (Propofol)',
                'وانکومایسین (Vancomycin)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'هیدروکورتیزون (Hydrocortisone)',
                'رانیتیدین (Ranitidine)',
                'پتاسیم کلراید (KCl)'
            ],
            incompatible: [
                'آموکسی سیلین (Amoxicillin)',
                'فنوباربیتال (Phenobarbital)',
                'هیدرالازین (Hydralazine)',
                'ناکسیلین (Nafcillin)',
                'امی کاسین (Amikacin)',
                'جنتامایسین (Gentamicin)',
                'آلبومین (Albumin)',
                'تتراسایکلین (Tetracycline)',
                'اریترومایسین (Erythromycin)',
                'هالوپریدول (Haloperidol)'
            ]
        },
        compatNotes: 'با داروهای آمفوتریسین B، سیپروفلوکساسین، هیدروکورتیزون و وانکومایسین سازگار است. از مخلوط کردن با آنتی‌بیوتیک‌های آمینوگلیکوزیدی خودداری شود.',
        administrationNotes: [
            'برای تزریق مداوم حتماً از پمپ انفوزیون استفاده شود',
            'بررسی APTT 6 ساعت پس از شروع درمان و سپس هر 24 ساعت',
            'تست زمان خونریزی (BT) قبل از شروع درمان الزامی است',
            'در بیماران با ترومبوسیتوپنی ناشی از هپارین (HIT) منع مصرف دارد',
            'دوز در نارسایی کلیه نیاز به تعدیل دارد',
            'در صورت اکستراوزاسیون، کمپرس گرم اعمال شود',
            'دوز پروفیلاکسی: 5000 واحد هر 8-12 ساعت زیرجلدی'
        ],
        monitoring: [
            'علائم خونریزی: ملنا، هماتوم، خونریزی لثه',
            'شمارش پلاکت هر 2-3 روز یکبار',
            'APTT هدف: 1.5-2.5 برابر کنترل',
            'کنترل هماتوکریت و هموگلوبین',
            'بررسی عملکرد کلیه و کبد'
        ],
        preparationSteps: [
            'شستن دست و استفاده از دستکش استریل',
            'آماده کردن 2 آمپول هپارین 5000 واحدی',
            'کشیدن 50 میلی‌لیتر سالین نرمال به سرنگ/کیسه انفوزیون',
            'اضافه کردن 10000 واحد هپارین به محلول',
            'مخلوط کردن آرام تا کاملاً یکنواخت شود',
            'نصب برچسب قرمز هپارین روی خط تزریق و پمپ',
            'تنظیم پمپ انفوزیون بر اساس محاسبات',
            'ثبت زمان شروع، دوز و نام پرستار در پرونده'
        ],
        specialInstructions: 'هرگز هپارین را به صورت عضلانی تزریق نکنید. در صورت فراموش شدن دوز، دوز بعدی را دو برابر نکنید.'
    },
    furosemide: {
        id: 'lasix',
        persianName: 'فوروزماید',
        englishName: 'Furosemide',
        alternativeNames: ['لازیکس', 'Lasix', 'Frusemide'],
        icon: 'fas fa-water',
        color: '#f093fb',
        category: 'Loop Diuretic',
        defaultAmpoules: 5,
        ampouleOptions: [
            { strength: 20, unit: 'mg', volume: 2, label: '20 mg in 2 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mg/h',
        weightBased: { active: false },
        typicalDoseRange: { min: 2, max: 40, unit: 'mg/h' },
        maxRate: '4 mg/min',
        solutionType: ['N.S', 'D5W'],
        ySiteCompatibilities: {
            compatible: [
                'دوپامین (Dopamine)',
                'دوبوتامین (Dobutamine)',
                'هپارین (Heparin)',
                'میدازولام (Midazolam)',
                'مورفین (Morphine)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'وانکومایسین (Vancomycin)',
                'سفتریاکسون (Ceftriaxone)',
                'هیدروکورتیزون (Hydrocortisone)',
                'رانیتیدین (Ranitidine)'
            ],
            incompatible: [
                'جنتامایسین (Gentamicin)',
                'امی کاسین (Amikacin)',
                'توبرامایسین (Tobramycin)',
                'پنسیلین G (Penicillin G)',
                'آمینوفیلین (Aminophylline)',
                'داکسوروبیسین (Doxorubicin)',
                'انسولین رگولار (Regular Insulin)',
                'آدنوزین (Adenosine)',
                'آسیکلوویر (Acyclovir)',
                'پنتوپرازول (Pantoprazole)'
            ]
        },
        compatNotes: 'با اکثر آنتی‌بیوتیک‌ها و کاتکول آمین‌ها سازگار است. با آمینوگلیکوزیدها و بعضی داروهای ضد سرطان ناسازگار است.',
        administrationNotes: [
            'تزریق آهسته برای جلوگیری از اتوتوکسیسیتی',
            'بررسی الکترولیت‌ها قبل و 6 ساعت پس از تزریق',
            'مونیتورینگ برون ده ادراری (هدف: 0.5-1 ml/kg/hr)',
            'در بیماران با نارسایی کلیه ممکن است نیاز به دوز بالاتر باشد',
            'تزریق بولوس در موارد اورژانس ادم ریوی',
            'دوز در نارسایی کبدی نیاز به تعدیل دارد',
            'مصرف همزمان با داروهای نفروتوکسیک ممنوع'
        ],
        monitoring: [
            'برون ده ادراری هر ساعت',
            'الکترولیت‌ها (K, Na, Cl, Mg, Ca)',
            'علائم دهیدراتاسیون',
            'فشار خون وضعیتی',
            'کراتینین و BUN',
            'علائم اتوتوکسیسیتی'
        ],
        preparationSteps: [
            'بررسی سطح الکترولیت‌ها قبل از تزریق',
            'آماده کردن 5 آمپول فوروزماید 20 میلی‌گرمی',
            'کشیدن 50 میلی‌لیتر سالین نرمال به سرنگ/کیسه',
            'اضافه کردن 100 میلی‌گرم فوروزماید به محلول',
            'مخلوط کردن کامل تا محلول شفاف شود',
            'تنظیم سرعت تزریق حداکثر 4 میلی‌گرم/دقیقه',
            'مونیتورینگ برون ده ادراری و علائم حیاتی',
            'ثبت دقیق ورودی و خروجی مایعات'
        ],
        specialInstructions: 'در صورت افت شدید پتاسیم، تزریق را متوقف و با پزشک مشورت کنید. تزریق سریع ممکن است باعث کری برگشت‌ناپذیر شود.'
    },
    insulin: {
        id: 'insulin',
        persianName: 'انسولین رگولار',
        englishName: 'Regular Insulin',
        alternativeNames: ['انسولین معمولی', 'Humulin R', 'Actrapid'],
        icon: 'fas fa-syringe',
        color: '#ff6b6b',
        category: 'Hormone',
        defaultAmpoules: 1,
        ampouleOptions: [
            { strength: 100, unit: 'units', volume: 1, label: '100 Unit in 1 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'units/h',
        weightBased: { 
            active: true, 
            unit: 'units/kg/h', 
            typical: 0.1,
            range: { min: 0.05, max: 0.2 },
            defaultUseWeight: false,
            defaultWeight: 70
        },
        typicalDoseRange: { min: 0.05, max: 0.2, unit: 'units/kg/h' },
        maxSafeConcentration: '1 units/mL',
        solutionType: ['N.S'],
        ySiteCompatibilities: {
            compatible: [
                'هپارین (Heparin)',
                'پتاسیم کلراید (KCl)',
                'رانیتیدین (Ranitidine)',
                'فاموتیدین (Famotidine)',
                'دکستروز 5% (D5W)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'وانکومایسین (Vancomycin)',
                'سفتریاکسون (Ceftriaxone)',
                'مترونیدازول (Metronidazole)',
                'هیدروکورتیزون (Hydrocortisone)'
            ],
            incompatible: [
                'فنی توئین (Phenytoin)',
                'داپسون (Dapsone)',
                'فوروزماید (Furosemide)',
                'پنتامیدین (Pentamidine)',
                'دوبوتامین (Dobutamine)',
                'نوراپی نفرین (Norepinephrine)',
                'دکستران (Dextran)',
                'لیپیدها (Lipids)',
                'TPN',
                'آلبومین (Albumin)'
            ]
        },
        compatNotes: 'انسولین در سالین نرمال پایدار است. از مخلوط کردن با محلول‌های حاوی پروتئین یا چربی خودداری شود.',
        administrationNotes: [
            'استفاده از پمپ سرنگ با دقت بالا (Syringe Pump)',
            'برچسب قرمز هشدار انسولین روی خط تزریق و پمپ',
            'کنترل قند خون کاپیلاری هر 1 ساعت در شروع درمان',
            'آماده بودن گلوکز 50% برای درمان هایپوگلیسمی',
            'تعویض خط تزریق هر 24 ساعت',
            'مصرف غذا در حین تزریق مداوم انسولین'
        ],
        monitoring: [
            'گلوکز خون کاپیلاری هر 1-2 ساعت',
            'علائم هایپوگلیسمی: تعریق، لرزش، تاکی کاردی',
            'علائم هیپرگلیسمی: پلی اوری، پلی دیپسی، کاهش هوشیاری',
            'سطح پتاسیم خون (انسولین باعث کاهش پتاسیم می‌شود)',
            'علائم کتواسیدوز در بیماران دیابتی'
        ],
        preparationSteps: [
            'شستن دست و استفاده از دستکش استریل',
            'آماده کردن 1 ویال انسولین 100 واحدی',
            'کشیدن 100 میلی‌لیتر سالین نرمال به کیسه انفوزیون',
            'اضافه کردن 100 واحد انسولین به کیسه',
            'مخلوط کردن آرام و یکنواخت (عدم تکان شدید)',
            'نصب برچسب قرمز هشدار انسولین روی خط و پمپ',
            'تنظیم پمپ انفوزیون بر اساس محاسبات',
            'کنترل قند خون قبل از شروع و 1 ساعت بعد'
        ],
        specialInstructions: 'هرگز انسولین را با دوز بالای گلوکز مخلوط نکنید. در صورت وقوع هایپوگلیسمی، تزریق را متوقف و 50cc گلوکز 50% تزریق کنید.'
    },
    fentanyl: {
        id: 'fentanyl',
        persianName: 'فنتانیل',
        englishName: 'Fentanyl Citrate',
        alternativeNames: ['سوبلیماز', 'Sublimaze', 'Duragesic'],
        icon: 'fas fa-head-side-mask',
        color: '#8b5cf6',
        category: 'Opioid Analgesic',
        defaultAmpoules: 1,
        ampouleOptions: [
            { strength: 500, unit: 'mcg', volume: 10, label: '0.5 mg in 10 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mcg/h',
        weightBased: { 
            active: true, 
            unit: 'mcg/kg/h', 
            typical: 1,
            range: { min: 0.5, max: 2 },
            defaultUseWeight: false,
            defaultWeight: 70
        },
        typicalDoseRange: { min: 25, max: 200, unit: 'mcg/h' },
        maxSafeConcentration: '50 mcg/mL',
        solutionType: ['N.S', 'D5W'],
        ySiteCompatibilities: {
            compatible: [
                'هپارین (Heparin)',
                'میدازولام (Midazolam)',
                'پروپوفول (Propofol)',
                'دکسمدتومیدین (Dexmedetomidine)',
                'مورفین (Morphine)',
                'رانیتیدین (Ranitidine)',
                'وانکومایسین (Vancomycin)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'سفتریاکسون (Ceftriaxone)',
                'هیدروکورتیزون (Hydrocortisone)'
            ],
            incompatible: [
                'تیوپنتال (Thiopental)',
                'فنی توئین (Phenytoin)',
                'لورازپام (Lorazepam)',
                'باربیتورات‌ها (Barbiturates)',
                'فنوباربیتال (Phenobarbital)',
                'داکسی سیکلین (Doxycycline)',
                'تتراسایکلین (Tetracycline)',
                'ایزونیازید (Isoniazid)',
                'ریفامپین (Rifampin)',
                'هالوپریدول (Haloperidol)'
            ]
        },
        compatNotes: 'فنتانیل با بنزودیازپین‌ها و پروپوفول سازگار است. با داروهای خواب‌آور و آنتی‌سایکوتیک‌ها خطر افسردگی تنفسی افزایش می‌یابد.',
        administrationNotes: [
            'استفاده از پمپ انفوزیون با قفل کنترل شده (PCA در صورت نیاز)',
            'دسترسی دائمی به نالوکسان (Narcan) برای آنتاگونیسم',
            'مونیتورینگ مداوم اکسیژن‌سنج و نرخ تنفس',
            'تهیه‌ی ساکشن و تجهیزات احیا در دسترس',
            'در بیماران سالمند و کودکان با احتیاط',
            'دوز در نارسایی کبدی و کلیوی نیاز به تعدیل دارد',
            'از قطع ناگهانی دارو خودداری شود (سندرم ترک)'
        ],
        monitoring: [
            'نرخ تنفس هر 15 دقیقه در شروع درمان',
            'اشباع اکسیژن (SpO2) مداوم',
            'سطح هوشیاری (GCS یا Ramsay Sedation Scale)',
            'فشار خون و ضربان قلب',
            'علائم درد (با استفاده از مقیاس درد)',
            'علائم اوردوز: اپنه، میوز، کاهش فشار خون'
        ],
        preparationSteps: [
            'تایید دستور پزشک برای دوز و مدت تزریق',
            'آماده کردن 1 آمپول فنتانیل 500 میکروگرمی',
            'کشیدن 50 میلی‌لیتر سالین نرمال به سرنگ/کیسه',
            'اضافه کردن 500 میکروگرم فنتانیل به محلول',
            'مخلوط کردن کامل محلول',
            'نصب برچسب "اپیوئید" روی خط تزریق',
            'تنظیم پمپ انفوزیون با محدودیت دوز (Dose Limit)',
            'آماده کردن نالوکسان در دسترس'
        ],
        specialInstructions: 'در صورت کاهش نرخ تنفس به کمتر از 8 بار در دقیقه یا SpO2 کمتر از 90%، تزریق را متوقف و نالوکسان تجویز کنید.'
    },
    pantoprazole: {
        id: 'pantoprazole',
        persianName: 'پنتوپرازول',
        englishName: 'Pantoprazole Sodium',
        alternativeNames: ['پروتونیکس', 'Protonix', 'Pantoloc'],
        icon: 'fas fa-tablets',
        color: '#5ac8fa',
        category: 'PPI',
        defaultAmpoules: 2,
        ampouleOptions: [
            { strength: 40, unit: 'mg', volume: 10, label: '40 mg' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mg/h',
        weightBased: { active: false },
        typicalDoseRange: { min: 40, max: 80, unit: 'mg/day' },
        maxRate: '7 mL/min',
        solutionType: ['N.S'],
        ySiteCompatibilities: {
            compatible: [
                'سالین نرمال (Normal Saline)',
                'رینگر لاکتات (Ringer\'s Lactate)',
                'دکستروز 5% (D5W)',
                'هپارین (Heparin)',
                'رانیتیدین (Ranitidine)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'وانکومایسین (Vancomycin)',
                'سفتریاکسون (Ceftriaxone)',
                'مترونیدازول (Metronidazole)',
                'هیدروکورتیزون (Hydrocortisone)'
            ],
            incompatible: [
                'دیازپام (Diazepam)',
                'فوروزماید (Furosemide)',
                'ونکومایسین (Vancomycin) - در برخی فرمولاسیون‌ها',
                'داکسی‌سایکلین (Doxycycline)',
                'میدازولام (Midazolam)',
                'زیدوودین (Zidovudine)',
                'فلوکونازول (Fluconazole)',
                'ایزونیازید (Isoniazid)',
                'ریفامپین (Rifampin)',
                'آمینوفیلین (Aminophylline)'
            ]
        },
        compatNotes: 'پنتوپرازول فقط با سالین نرمال سازگار است. از مخلوط کردن با سایر محلول‌ها خودداری شود. تزریق باید در لاین جداگانه انجام شود.',
        administrationNotes: [
            'تزریق آهسته (حداقل 15 دقیقه برای هر 40 میلی‌گرم)',
            'بررسی pH معده در درمان طولانی مدت',
            'در بیماران با اختلال کبدی دوز را کاهش دهید',
            'تست عملکرد کبد قبل از شروع درمان',
            'تداخل با داروهای متابولیزه شده توسط سیتوکروم P450',
            'خطر پنومونی ناشی از بیمارستان در مصرف طولانی',
            'دوز در سالمندان نیاز به تعدیل ندارد'
        ],
        monitoring: [
            'علائم خونریزی GI',
            'سطح منیزیم خون (خطر هایپومنیزیمی)',
            'علائم آلرژیک',
            'عملکرد کبدی',
            'علائم پنومونی آسپیراسیون',
            'تعادل اسید-باز'
        ],
        preparationSteps: [
            'باز کردن ویال پنتوپرازول 40 میلی‌گرمی',
            'افزودن 10 میلی‌لیتر سالین نرمال به ویال',
            'مخلوط کردن آرام تا پودر کاملاً حل شود',
            'کشیدن محلول آماده به سرنگ/کیسه',
            'اضافه کردن حجم به 100 میلی‌لیتر با سالین نرمال',
            'تنظیم پمپ انفوزیون برای تزریق در 15 دقیقه',
            'تزریق از لاین جداگانه یا فلاشینگ قبل و بعد',
            'ثبت زمان و دوز در پرونده'
        ],
        specialInstructions: 'هرگز پنتوپرازول را با سایر داروها در یک سرنگ مخلوط نکنید. در صورت تزریق سریع خطر واکنش آنافیلاکتیک وجود دارد.'
    },
    nitroglycerin: {
        id: 'tng',
        persianName: 'نیتروگلیسیرین',
        englishName: 'Nitroglycerin',
        alternativeNames: ['نیتروگلیسیرین تزریقی', 'Nitrostat', 'Nitro-Bid', 'TNG', 'تی ان جی'],
        icon: 'fas fa-heartbeat',
        color: '#ffa726',
        category: 'Vasodilator',
        defaultAmpoules: 1,
        ampouleOptions: [
            { strength: 5, unit: 'mg', volume: 2, label: '5 mg in 2 mL' },
            { strength: 10, unit: 'mg', volume: 2, label: '10 mg in 2 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mcg/min',
        weightBased: { active: false },
        typicalDoseRange: { min: 5, max: 200, unit: 'mcg/min' },
        maxConcentration: '400 mcg/mL',
        solutionType: ['D5W'],
        ySiteCompatibilities: {
            compatible: [
                'دوپامین (Dopamine)',
                'دوبوتامین (Dobutamine)',
                'هپارین (Heparin)',
                'مورفین (Morphine)',
                'لیدوکائین (Lidocaine)',
                'آمیودارون (Amiodarone)',
                'رانیتیدین (Ranitidine)',
                'وانکومایسین (Vancomycin)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'فاموتیدین (Famotidine)'
            ],
            incompatible: [
                'فنی توئین (Phenytoin)',
                'هپارین (Heparin) - در بعضی فرمولاسیون‌ها',
                'بی‌کربنات سدیم (Sodium Bicarbonate)',
                'فوروزماید (Furosemide)',
                'لورازپام (Lorazepam)',
                'پنتوباربیتال (Pentobarbital)',
                'توبرامایسین (Tobramycin)',
                'آمینوفیلین (Aminophylline)',
                'داکسی‌سایکلین (Doxycycline)',
                'ایزونیازید (Isoniazid)'
            ]
        },
        compatNotes: 'نیتروگلیسیرین فقط با D5W سازگار است. هرگز با سالین نرمال مخلوط نکنید. در معرض نور و حرارت تجزیه می‌شود.',
        administrationNotes: [
            'استفاده از پمپ انفوزیون با دقت بالا',
            'محافظت از نور با فویل آلومینیومی',
            'تست تحمل نیترات در شروع درمان',
            'مانیتورینگ مداوم فشار خون (هر 5 دقیقه در شروع)',
            'درمان با کمترین دوز موثر',
            'قطع تدریجی برای جلوگیری از ریباند',
            'ممنوعیت همراهی با مهارکننده‌های PDE5 (ویاگرا)'
        ],
        monitoring: [
            'فشار خون و ضربان قلب هر 5-15 دقیقه',
            'علائم سردرد (نشانه اثربخشی)',
            'علائم افت فشار وضعیتی',
            'ECG برای ایسکمی',
            'علائم متهموگلوبینمی',
            'برون ده ادراری'
        ],
        preparationSteps: [
            'بررسی تاریخ انقضای آمپول نیتروگلیسیرین',
            'آماده کردن 1 آمپول 5 میلی‌گرمی',
            'کشیدن 100 میلی‌لیتر D5W به کیسه انفوزیون',
            'اضافه کردن 5 میلی‌گرم نیتروگلیسیرین به محلول',
            'پیچیدن کیسه در فویل آلومینیومی',
            'تنظیم پمپ انفوزیون بر اساس محاسبات',
            'مانیتورینگ فشار خون قبل و 5 دقیقه بعد از شروع',
            'ثبت واکنش بیمار به درمان'
        ],
        specialInstructions: 'در صورت افت فشار خون شدید (SBP < 90 mmHg)، تزریق را متوقف کرده و با سرم نرمال سالین حجم دهید.'
    },
    norepinephrine: {
        id: 'norepinephrine',
        persianName: 'نوراپی نفرین',
        englishName: 'Norepinephrine',
        alternativeNames: ['لوووفد', 'Levophed', 'Noradrenaline'],
        icon: 'fas fa-heart-pulse',
        color: '#4cd964',
        category: 'Vasopressor',
        defaultAmpoules: 1,
        ampouleOptions: [
            { strength: 4, unit: 'mg', volume: 4, label: '4 mg in 4 mL' },
            { strength: 5, unit: 'mg', volume: 10, label: '5 mg in 10 mL' },
            { strength: 10, unit: 'mg', volume: 10, label: '10mg in 10mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mcg/min',
        weightBased: { 
            active: true, 
            unit: 'mcg/kg/min', 
            typical: 0.1,
            range: { min: 0.05, max: 0.3 },
            defaultUseWeight: false,
            defaultWeight: 70
        },
        typicalDoseRange: { min: 0.05, max: 0.3, unit: 'mcg/kg/min' },
        maxConcentration: '16 mcg/mL',
        solutionType: ['D5W'],
        lineRequirement: 'لاین مرکزی الزامی',
        ySiteCompatibilities: {
            compatible: [
                'دوپامین (Dopamine)',
                'دوبوتامین (Dobutamine)',
                'وازوپرسین (Vasopressin)',
                'اپی نفرین (Epinephrine)',
                'هیدروکورتیزون (Hydrocortisone)',
                'وانکومایسین (Vancomycin)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'سفتریاکسون (Ceftriaxone)',
                'مترونیدازول (Metronidazole)',
                'هپارین (Heparin)'
            ],
            incompatible: [
                'ناکسیلین (Nafcillin)',
                'فنتانیل (Fentanyl) - در غلظت بالا',
                'بی‌کربنات سدیم (Sodium Bicarbonate)',
                'تیوپنتال (Thiopental)',
                'پنتوباربیتال (Pentobarbital)',
                'آمینوفیلین (Aminophylline)',
                'داکسی‌سایکلین (Doxycycline)',
                'ایزونیازید (Isoniazid)',
                'ریفامپین (Rifampin)',
                'فوروزماید (Furosemide)'
            ]
        },
        compatNotes: 'نوراپی نفرین با بیشتر کاتکول آمین‌ها سازگار است. از مخلوط کردن با داروهای قلیایی خودداری شود. تزریق باید از لاین مرکزی انجام شود.',
        administrationNotes: [
            'تزریق از لاین مرکزی الزامی است',
            'پمپ انفوزیون جداگانه برای هر وازوپرسور',
            'مانیتورینگ فشار خون شریانی مداوم',
            'دسترسی وریدی اضطراری برای درمان اکستراوزاسیون',
            'فنتوآمین (Phentolamine) برای درمان اکستراوزاسیون',
            'دوز در بیماران هیپوولمیک مؤثر نیست (اول حجم دهید)',
            'قطع تدریجی برای جلوگیری از افت فشار'
        ],
        monitoring: [
            'فشار خون شریانی مداوم',
            'ضربان قلب و ریتم قلبی',
            'برون ده ادراری (هدف > 0.5 ml/kg/hr)',
            'لاکتات خون',
            'علائم اکستراوزاسیون (سیانوز، درد، تاول)',
            'سیانوز محیطی',
            'ECG برای ایسکمی'
        ],
        preparationSteps: [
            'تایید دستور پزشک و بررسی لاین مرکزی',
            'آماده کردن 1 آمپول نوراپی نفرین 4 میلی‌گرمی',
            'کشیدن 250 میلی‌لیتر D5W به کیسه انفوزیون',
            'اضافه کردن 4 میلی‌گرم نوراپی نفرین به محلول',
            'مخلوط کردن کامل محلول',
            'اتصال به پمپ انفوزیون جداگانه',
            'تنظیم پمپ بر اساس محاسبات',
            'علامت‌گذاری واضح خط تزریق'
        ],
        specialInstructions: 'در صورت اکستراوزاسیون، تزریق را متوقف کرده و فنتوآمین 5-10 میلی‌گرم در 10 میلی‌لیتر سالین نرمال به صورت موضعی تزریق کنید.'
    },
    midazolam: {
        id: 'midazolam',
        persianName: 'میدازولام',
        englishName: 'Midazolam',
        alternativeNames: ['ورسید', 'Versed', 'Hypnovel'],
        icon: 'fas fa-bed',
        color: '#764ba2',
        category: 'Benzodiazepine',
        defaultAmpoules: 5,
        ampouleOptions: [
            { strength: 5, unit: 'mg', volume: 1, label: '5 mg in 1 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mg/h',
        weightBased: { 
            active: true, 
            unit: 'mcg/kg/min', 
            typical: 1,
            range: { min: 0.5, max: 5 },
            defaultUseWeight: false,
            defaultWeight: 70
        },
        typicalDoseRange: { min: 0.02, max: 0.1, unit: 'mg/kg/h' },
        maxConcentration: '1 mg/mL',
        solutionType: ['N.S', 'D5W'],
        antagonist: 'فلومازنیل (Anexate)',
        ySiteCompatibilities: {
            compatible: [
                'هپارین (Heparin)',
                'فنتانیل (Fentanyl)',
                'پروپوفول (Propofol)',
                'دکسمدتومیدین (Dexmedetomidine)',
                'مورفین (Morphine)',
                'رانیتیدین (Ranitidine)',
                'وانکومایسین (Vancomycin)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'سفتریاکسون (Ceftriaxone)',
                'هیدروکورتیزون (Hydrocortisone)'
            ],
            incompatible: [
                'تیوپنتال (Thiopental)',
                'کتوکونازول (Ketoconazole)',
                'ایتراکونازول (Itraconazole)',
                'ریتوناویر (Ritonavir)',
                'ساکوئیناویر (Saquinavir)',
                'داکسی‌سایکلین (Doxycycline)',
                'ایزونیازید (Isoniazid)',
                'ریفامپین (Rifampin)',
                'فنی توئین (Phenytoin)',
                'کاربامازپین (Carbamazepine)'
            ]
        },
        compatNotes: 'میدازولام با اکثر داروهای آرام‌بخش سازگار است. تداخل با مهارکننده‌های CYP3A4 باعث افزایش سطح سرمی می‌شود.',
        administrationNotes: [
            'استفاده از پمپ انفوزیون با محدودیت دوز',
            'دسترسی دائمی به فلومازنیل (آنتاگونیست)',
            'مونیتورینگ مداوم اکسیژن‌سنج و نرخ تنفس',
            'تجهیزات احیا و انتوباسیون در دسترس',
            'در بیماران سالمند با احتیاط (نیمه عمر طولانی‌تر)',
            'دوز در نارسایی کبدی کاهش می‌یابد',
            'از قطع ناگهانی برای جلوگیری از سندرم ترک خودداری شود'
        ],
        monitoring: [
            'سطح هوشیاری (با استفاده از Ramsay Sedation Scale)',
            'نرخ تنفس و اشباع اکسیژن',
            'فشار خون و ضربان قلب',
            'علائم پارادوکسیکال ریکشن',
            'عملکرد کبدی در درمان طولانی',
            'تحمل و وابستگی'
        ],
        preparationSteps: [
            'تایید دستور پزشک و هدف سدیشن',
            'آماده کردن 5 آمپول میدازولام 5 میلی‌گرمی',
            'کشیدن 50 میلی‌لیتر سالین نرمال به سرنگ/کیسه',
            'اضافه کردن 25 میلی‌گرم میدازولام به محلول',
            'مخلوط کردن کامل محلول',
            'نصب برچسب "آرام‌بخش" روی خط تزریق',
            'تنظیم پمپ انفوزیون بر اساس محاسبات',
            'آماده کردن فلومازنیل در دسترس'
        ],
        specialInstructions: 'در بیماران سالمند با دوز کم شروع کنید. در صورت کاهش نرخ تنفس به کمتر از 8 یا SpO2 کمتر از 90%، دوز را کاهش دهید.'
    },
    octreotide: {
        id: 'octreotide',
        persianName: 'اکترئوتاید',
        englishName: 'Octreotide',
        alternativeNames: ['ساندوستاتین', 'Sandostatin'],
        icon: 'fas fa-seedling',
        color: '#f5576c',
        category: 'Hormone',
        defaultAmpoules: 5,
        ampouleOptions: [
            { strength: 50, unit: 'mcg', volume: 1, label: '50 mcg in 1 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mcg/h',
        weightBased: { active: false },
        typicalDoseRange: { min: 25, max: 50, unit: 'mcg/h' },
        maxConcentration: '50 mcg/mL',
        solutionType: ['N.S'],
        ySiteCompatibilities: {
            compatible: [
                'سالین نرمال (Normal Saline)',
                'هپارین (Heparin)',
                'رانیتیدین (Ranitidine)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'وانکومایسین (Vancomycin)',
                'سفتریاکسون (Ceftriaxone)',
                'مترونیدازول (Metronidazole)',
                'هیدروکورتیزون (Hydrocortisone)',
                'فاموتیدین (Famotidine)',
                'پتاسیم کلراید (KCl)'
            ],
            incompatible: [
                'TPN (تغذیه توتال پارنترال)',
                'لیپیدها (Lipids)',
                'آمینوفیلین (Aminophylline)',
                'داکسی‌سایکلین (Doxycycline)',
                'ایزونیازید (Isoniazid)',
                'ریفامپین (Rifampin)',
                'فنی توئین (Phenytoin)',
                'کاربامازپین (Carbamazepine)',
                'فوروزماید (Furosemide)',
                'پنتوپرازول (Pantoprazole)'
            ]
        },
        compatNotes: 'اکترئوتاید فقط با سالین نرمال سازگار است. از مخلوط کردن با محلول‌های حاوی چربی یا آمینواسید خودداری شود.',
        administrationNotes: [
            'تزریق زیرجلدی برای درمان طولانی مدت',
            'تزریق وریدی برای موارد اورژانسی',
            'بررسی قند خون قبل و بعد از تزریق',
            'ممکن است نیاز به کاهش دوز انسولین داشته باشد',
            'خطر سنگ کیسه صفرا در درمان طولانی',
            'دوز در نارسایی کلیه و کبد نیاز به تعدیل دارد',
            'در بارداری فقط در صورت ضرورت'
        ],
        monitoring: [
            'قند خون قبل و 1 ساعت بعد از تزریق',
            'علائم هیپوگلیسمی',
            'علائم سنگ کیسه صفرا',
            'عملکرد تیروئید',
            'الکترولیت‌ها',
            'علائم GI (اسهال، درد شکم)'
        ],
        preparationSteps: [
            'بررسی تاریخ انقضای ویال اکترئوتاید',
            'آماده کردن 5 آمپول 50 میکروگرمی',
            'کشیدن 100 میلی‌لیتر سالین نرمال به کیسه',
            'اضافه کردن 250 میکروگرم اکترئوتاید به محلول',
            'مخلوط کردن آرام تا کاملاً حل شود',
            'تنظیم پمپ انفوزیون بر اساس محاسبات',
            'کنترل قند خون قبل از شروع',
            'نگهداری محلول آماده در یخچال اگر استفاده نشود'
        ],
        specialInstructions: 'در بیماران دیابتیک، قند خون را به دقت مانیتور کنید. ممکن است نیاز به کاهش دوز انسولین یا داروهای خوراکی باشد.'
    },
    labetalol: {
        id: 'labetalol',
        persianName: 'لابتالول',
        englishName: 'Labetalol',
        alternativeNames: ['تراندیت', 'Trandate', 'Normodyne'],
        icon: 'fas fa-heart',
        color: '#4facfe',
        category: 'Alpha/Beta Blocker',
        defaultAmpoules: 1,
        ampouleOptions: [
            { strength: 100, unit: 'mg', volume: 20, label: '100 mg in 20 mL' },
            { strength: 20, unit: 'mg', volume: 4, label: '20 mg in 4 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mg/min',
        weightBased: { active: false },
        typicalDoseRange: { min: 20, max: 160, unit: 'mg/h' },
        maxConcentration: '1 mg/mL',
        solutionType: ['D5W'],
        ySiteCompatibilities: {
            compatible: [
                'سالین نرمال (Normal Saline)',
                'هپارین (Heparin)',
                'رانیتیدین (Ranitidine)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'وانکومایسین (Vancomycin)',
                'سفتریاکسون (Ceftriaxone)',
                'مترونیدازول (Metronidazole)',
                'هیدروکورتیزون (Hydrocortisone)',
                'فاموتیدین (Famotidine)',
                'پتاسیم کلراید (KCl)'
            ],
            incompatible: [
                'بی‌کربنات سدیم (Sodium Bicarbonate)',
                'فوروزماید (Furosemide)',
                'آمینوفیلین (Aminophylline)',
                'داکسی‌سایکلین (Doxycycline)',
                'ایزونیازید (Isoniazid)',
                'ریفامپین (Rifampin)',
                'فنی توئین (Phenytoin)',
                'کاربامازپین (Carbamazepine)',
                'پنتوباربیتال (Pentobarbital)',
                'تیوپنتال (Thiopental)'
            ]
        },
        compatNotes: 'لابتالول با D5W سازگار است. از مخلوط کردن با محلول‌های قلیایی خودداری شود. تزریق باید آهسته باشد.',
        administrationNotes: [
            'تزریق آهسته برای جلوگیری از افت فشار ناگهانی',
            'مانیتورینگ فشار خون هر 5 دقیقه در شروع',
            'در بیماران آسمی و COPD منع مصرف دارد',
            'دوز در نارسایی کبدی کاهش می‌یابد',
            'در بارداری برای پره‌اکلامپسی استفاده می‌شود',
            'خطر برادی کاردی و بلوک قلبی',
            'قطع تدریجی برای جلوگیری از ریباند'
        ],
        monitoring: [
            'فشار خون و ضربان قلب هر 5-15 دقیقه',
            'ECG برای برادی کاردی و بلوک',
            'علائم نارسایی قلبی',
            'علائم برونکواسپاسم',
            'عملکرد کبدی',
            'سطح قند خون در بیماران دیابتی'
        ],
        preparationSteps: [
            'تایید دستور پزشک و هدف فشار خون',
            'آماده کردن ویال لابتالول 100 میلی‌گرمی',
            'کشیدن 100 میلی‌لیتر D5W به کیسه انفوزیون',
            'اضافه کردن 100 میلی‌گرم لابتالول به محلول',
            'مخلوط کردن کامل تا محلول شفاف شود',
            'تنظیم پمپ انفوزیون برای تزریق آهسته',
            'مانیتورینگ فشار خون قبل و 5 دقیقه بعد از شروع',
            'آماده بودن آتروپین برای درمان برادی کاردی'
        ],
        specialInstructions: 'در صورت افت فشار خون شدید یا برادی کاردی علامت‌دار، تزریق را متوقف کرده و با سرم نرمال سالین حجم دهید.'
    },
    dopamine: {
        id: 'dopamine',
        persianName: 'دوپامین',
        englishName: 'Dopamine',
        alternativeNames: ['اینوتروپ', 'Dopastat', 'Intropin'],
        icon: 'fas fa-heartbeat',
        color: '#ff4081',
        category: 'Inotrope',
        defaultAmpoules: 1,
        ampouleOptions: [
            { strength: 200, unit: 'mg', volume: 5, label: '200 mg in 5 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500, 1000] 
        },
        defaultVolume: { syringe: 50, infusion: 250 },
        standardUnit: 'mcg/min',
        weightBased: { 
            active: true, 
            unit: 'mcg/kg/min', 
            typical: 5,
            range: { min: 2, max: 20 },
            defaultUseWeight: false,
            defaultWeight: 70
        },
        typicalDoseRange: { min: 2, max: 20, unit: 'mcg/kg/min' },
        maxConcentration: '800 mcg/mL',
        solutionType: ['D5W', 'N.S'],
        lineRequirement: 'لاین مرکزی برای دوزهای بالا (>10 میکروگرم/کیلوگرم/دقیقه)',
        ySiteCompatibilities: {
            compatible: [
                'دوپامین (Dopamine)',
                'دوبوتامین (Dobutamine)',
                'نوراپی نفرین (Norepinephrine)',
                'میدازولام (Midazolam)',
                'هپارین (Heparin)',
                'رانیتیدین (Ranitidine)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'وانکومایسین (Vancomycin)',
                'سفتریاکسون (Ceftriaxone)',
                'هیدروکورتیزون (Hydrocortisone)'
            ],
            incompatible: [
                'ناکسیلین (Nafcillin)',
                'فنتانیل (Fentanyl) - در غلظت بالا',
                'بی‌کربنات سدیم (Sodium Bicarbonate)',
                'آمینوفیلین (Aminophylline)',
                'داکسی‌سایکلین (Doxycycline)',
                'ایزونیازید (Isoniazid)',
                'ریفامپین (Rifampin)',
                'فنی توئین (Phenytoin)',
                'کاربامازپین (Carbamazepine)',
                'پنتوباربیتال (Pentobarbital)'
            ]
        },
        compatNotes: 'دوپامین با اکثر کاتکول آمین‌ها سازگار است. از مخلوط کردن با داروهای قلیایی خودداری شود. در معرض نور تجزیه می‌شود.',
        administrationNotes: [
            'دوز کم (2-5 میکروگرم/کیلوگرم/دقیقه): اثر دوپامینرژیک - افزایش برون ده ادراری',
            'دوز متوسط (5-10 میکروگرم/کیلوگرم/دقیقه): اثر بتا - افزایش برون ده قلبی',
            'دوز بالا (>10 میکروگرم/کیلوگرم/دقیقه): اثر آلفا - وازوکونستریکشن',
            'تزریق از لاین مرکزی برای دوزهای بالا',
            'محافظت از نور با فویل آلومینیومی',
            'در بیماران با فئوکروموسیتوما ممنوع',
            'قطع تدریجی برای جلوگیری از افت فشار'
        ],
        monitoring: [
            'فشار خون و ضربان قلب هر 5-15 دقیقه',
            'برون ده ادراری (هدف > 0.5 ml/kg/hr)',
            'ریتم قلبی (خطر آریتمی)',
            'علائم اکستراوزاسیون',
            'لاکتات خون',
            'سیانوز محیطی'
        ],
        preparationSteps: [
            'تایید دستور پزشک و بررسی لاین وریدی',
            'آماده کردن 1 آمپول دوپامین 200 میلی‌گرمی',
            'کشیدن 250 میلی‌لیتر D5W یا سالین نرمال به کیسه',
            'اضافه کردن 200 میلی‌گرم دوپامین به محلول',
            'مخلوط کردن کامل محلول',
            'پیچیدن کیسه در فویل آلومینیومی',
            'تنظیم پمپ انفوزیون بر اساس محاسبات',
            'مانیتورینگ فشار خون و ضربان قلب'
        ],
        specialInstructions: 'در صورت اکستراوزاسیون، تزریق را متوقف کرده و فنتوآمین 5-10 میلی‌گرم در 10 میلی‌لیتر سالین نرمال به صورت موضعی تزریق کنید.'
    },
    amiodarone: {
        id: 'amiodarone',
        persianName: 'آمیودارون',
        englishName: 'Amiodarone',
        alternativeNames: ['کوردارون', 'Cordarone', 'Pacerone'],
        icon: 'fas fa-heartbeat',
        color: '#4CAF50',
        category: 'Antiarrhythmic',
        defaultAmpoules: 2,
        ampouleOptions: [
            { strength: 150, unit: 'mg', volume: 3, label: '150 mg in 3 mL' }
        ],
        defaultSolutionVolumes: { 
            syringe: [10, 20, 50], 
            infusion: [100, 250, 500] 
        },
        defaultVolume: { syringe: 50, infusion: 100 },
        standardUnit: 'mg/min',
        weightBased: { active: false },
        typicalDoseRange: { min: 0.5, max: 1, unit: 'mg/min' },
        maxConcentration: '2 mg/min',
        solutionType: ['D5W'],
        ySiteCompatibilities: {
            compatible: [
                'لیدوکائین (Lidocaine)',
                'فوروزماید (Furosemide)',
                'هپارین (Heparin)',
                'رانیتیدین (Ranitidine)',
                'سیپروفلوکساسین (Ciprofloxacin)',
                'وانکومایسین (Vancomycin)',
                'سفتریاکسون (Ceftriaxone)',
                'مترونیدازول (Metronidazole)',
                'هیدروکورتیزون (Hydrocortisone)',
                'فاموتیدین (Famotidine)'
            ],
            incompatible: [
                'هپارین (Heparin) - در بعضی فرمولاسیون‌ها',
                'بی‌کربنات سدیم (Sodium Bicarbonate)',
                'آمینوفیلین (Aminophylline)',
                'داکسی‌سایکلین (Doxycycline)',
                'ایزونیازید (Isoniazid)',
                'ریفامپین (Rifampin)',
                'فنی توئین (Phenytoin)',
                'کاربامازپین (Carbamazepine)',
                'وارفارین (Warfarin)',
                'دیگوکسین (Digoxin)'
            ]
        },
        compatNotes: 'آمیودارون فقط با D5W سازگار است. هرگز با سالین نرمال مخلوط نکنید. تداخل با بسیاری از داروها دارد.',
        administrationNotes: [
            'تزریق از لاین مرکزی به دلیل تحریک وریدی',
            'مانیتورینگ ECG مداوم',
            'بررسی عملکرد تیروئید، کبد و ریه قبل از شروع',
            'خطر فیبروز ریوی در درمان طولانی',
            'دوز بارگیری (Loading dose) در موارد اورژانسی',
            'تداخل با بسیاری از داروها (به ویژه وارفارین)',
            'نیمه عمر طولانی (40-55 روز)'
        ],
        monitoring: [
            'ECG مداوم برای QT interval',
            'علائم فیبروز ریوی (سرفه، تنگی نفس)',
            'عملکرد تیروئید (TSH)',
            'عملکرد کبدی (AST, ALT, Alk Phos)',
            'معاینه چشم (خطر نوروپاتی اپتیک)',
            'سطح دارو در خون',
            'علائم پوستی (فوتوسنسیتیویتی)'
        ],
        preparationSteps: [
            'بررسی عملکرد تیروئید و کبد قبل از شروع',
            'آماده کردن 2 آمپول آمیودارون 150 میلی‌گرمی',
            'کشیدن 100 میلی‌لیتر D5W به کیسه انفوزیون',
            'اضافه کردن 300 میلی‌گرم آمیودارون به محلول',
            'مخلوط کردن کامل تا محلول شفاف شود',
            'استفاده از فیلتر 0.2 میکرون (در صورت موجود بودن)',
            'تنظیم پمپ انفوزیون بر اساس محاسبات',
            'مانیتورینگ ECG قبل و بعد از شروع'
        ],
        specialInstructions: 'در صورت افزایش QT interval به بیش از 500 ms یا ظهور Torsades de Pointes، تزریق را متوقف کنید. پایش ریوی هر 6-12 ماه ضروری است.'
    },
    lidocaine: {
        id: 'lidocaine',
        persianName: 'لیدوکائین',
        englishName: 'Lidocaine',
        alternativeNames: ['لیگنوکائین', 'Lignocaine', 'Xylocaine'],
        icon: 'fas fa-bolt',
        color: '#7c3aed',
        category: 'Antiarrhythmic',
        defaultAmpoules: 2,
        ampouleOptions: [
            { strength: 100, unit: 'mg', volume: 5, label: '100 mg in 5 mL' }
        ],
        defaultSolutionVolumes: {
            syringe: [10, 20, 50],
            infusion: [100, 250, 500]
        },
        defaultVolume: { syringe: 50, infusion: 250 },
        standardUnit: 'mg/min',
        weightBased: {
            active: true,
            unit: 'mcg/kg/min',
            typical: 20,
            range: { min: 10, max: 50 },
            defaultUseWeight: false,
            defaultWeight: 70
        },
        typicalDoseRange: { min: 1, max: 4, unit: 'mg/min' },
        maxConcentration: '8 mg/mL',
        solutionType: ['D5W', 'N.S'],
        lineRequirement: 'محیطی یا مرکزی',
        ySiteCompatibilities: {
            compatible: [
                'هپارین (Heparin)',
                'دوپامین (Dopamine)',
                'نیتروگلیسرین (Nitroglycerin)',
                'لابتالول (Labetalol)',
                'میدازولام (Midazolam)',
                'مورفین (Morphine)',
                'فنتانیل (Fentanyl)'
            ],
            incompatible: [
                'آمفوتریسین B (Amphotericin B)',
                'بی‌کربنات سدیم (Sodium Bicarbonate)',
                'سفازولین (Cefazolin)',
                'فنی‌توئین (Phenytoin)',
                'ایندومتاسین (Indomethacin)'
            ]
        },
        compatNotes: 'لیدوکائین در D5W پایدار است. از محلول‌های قلیایی اجتناب شود.',
        administrationNotes: [
            'بولوس لودینگ: ۱–۱.۵ میلی‌گرم/کیلوگرم IV طی ۲ دقیقه',
            'نگهداری: ۱–۴ میلی‌گرم/دقیقه (معادل ۲۰–۵۰ میکروگرم/کیلوگرم/دقیقه)',
            'در نارسایی کبدی دوز را کاهش دهید',
            'در نارسایی قلبی نیمه‌عمر طولانی می‌شود',
            'اگر آریتمی کنترل نشد، بولوس ۰.۵ میلی‌گرم/کیلوگرم می‌توان تکرار کرد (حداکثر ۳ mg/kg)'
        ],
        monitoring: [
            'ریتم قلبی پیوسته',
            'علائم مسمومیت: لرزش، اختلال بینایی، تشنج',
            'سطح سرمی (هدف: ۱.۵–۵ میکروگرم/مل)',
            'فشار خون',
            'سطح هوشیاری'
        ],
        preparationSteps: [
            'تایید دستور پزشک',
            'آماده کردن دو آمپول لیدوکائین ۱۰۰ میلی‌گرمی',
            'اضافه کردن ۲۰۰ میلی‌گرم به ۲۵۰ میلی‌لیتر D5W',
            'غلظت نهایی: ۰.۸ میلی‌گرم/مل',
            'تنظیم پمپ بر اساس وزن بیمار'
        ],
        specialInstructions: 'در بیماران با بلوک قلبی درجه ۲ یا ۳ بدون پیس‌میکر ممنوع است. در سندرم Wolf-Parkinson-White احتیاط شود.'
    },
    dobutamine: {
        id: 'dobutamine',
        persianName: 'دوبوتامین',
        englishName: 'Dobutamine',
        alternativeNames: ['دوبوترکس', 'Dobutrex', 'Inotrex'],
        icon: 'fas fa-heart-pulse',
        color: '#e11d48',
        category: 'Inotrope',
        defaultAmpoules: 1,
        ampouleOptions: [
            { strength: 250, unit: 'mg', volume: 20, label: '250 mg in 20 mL' }
        ],
        defaultSolutionVolumes: {
            syringe: [10, 20, 50],
            infusion: [100, 250, 500]
        },
        defaultVolume: { syringe: 50, infusion: 250 },
        standardUnit: 'mcg/min',
        weightBased: {
            active: true,
            unit: 'mcg/kg/min',
            typical: 5,
            range: { min: 2, max: 20 },
            defaultUseWeight: false,
            defaultWeight: 70
        },
        typicalDoseRange: { min: 2, max: 20, unit: 'mcg/kg/min' },
        maxConcentration: '1000 mcg/mL',
        solutionType: ['D5W', 'N.S'],
        lineRequirement: 'ترجیحاً لاین مرکزی',
        ySiteCompatibilities: {
            compatible: [
                'دوپامین (Dopamine)',
                'نوراپی‌نفرین (Norepinephrine)',
                'هپارین (Heparin)',
                'میدازولام (Midazolam)',
                'فنتانیل (Fentanyl)',
                'مورفین (Morphine)',
                'لیدوکائین (Lidocaine)',
                'نیتروگلیسرین (Nitroglycerin)'
            ],
            incompatible: [
                'بی‌کربنات سدیم (Sodium Bicarbonate)',
                'آسیکلوویر (Acyclovir)',
                'سفامندول (Cefamandole)',
                'آلتپلاز (Alteplase)',
                'ایندومتاسین (Indomethacin)',
                'پنتوباربیتال (Pentobarbital)'
            ]
        },
        compatNotes: 'دوبوتامین با اکثر داروهای مراقبت ویژه سازگار است. از محلول‌های قلیایی و اکسنده‌ها اجتناب شود.',
        administrationNotes: [
            'دوز معمول: ۲–۲۰ میکروگرم/کیلوگرم/دقیقه',
            'دوز بالا (>۱۵): ریسک تاکیکاردی افزایش می‌یابد',
            'تیتراسیون آهسته بر اساس پاسخ همودینامیک',
            'قطع تدریجی برای جلوگیری از هیپوتانسیون ریباند',
            'در تاکیکاردی یا آریتمی‌های فوق‌بطنی با احتیاط استفاده شود'
        ],
        monitoring: [
            'فشار خون مداوم (آرتریال لاین ترجیحی)',
            'ضربان قلب و ریتم قلبی پیوسته',
            'برون ده قلبی و SVR (در صورت وجود پولمونری کاتتر)',
            'دیورز ادراری',
            'علائم پرفیوژن بافتی (لاکتات، رنگ پوست)',
            'پایش اکستراوزاسیون'
        ],
        preparationSteps: [
            'تایید دستور پزشک',
            'آماده کردن آمپول ۲۵۰ میلی‌گرمی دوبوتامین',
            'اضافه کردن به ۲۵۰ میلی‌لیتر D5W (غلظت: ۱ میلی‌گرم/مل)',
            'محاسبه سرعت بر اساس وزن بیمار',
            'تنظیم پمپ انفوزیون',
            'پایش فشار خون و ضربان قلب هر ۵ دقیقه در شروع'
        ],
        specialInstructions: 'دوبوتامین یک آمین سمپاتومیمتیک مستقیم است — در صورت کاردیومیوپاتی هیپرتروفیک انسدادی (HOCM) ممنوع است. در AF ممکن است AV Conduction را تسریع کند.'
    },

};

function searchDrugs(query) {
    const normalizedQuery = query.toLowerCase().trim();
    
    if (!normalizedQuery) {
        return Object.keys(drugDatabase);
    }
    
    const results = [];
    
    Object.entries(drugDatabase).forEach(([id, drug]) => {
        const searchableText = [
            drug.persianName,
            drug.englishName,
            drug.category,
            ...(drug.alternativeNames || [])
        ].join(' ').toLowerCase();
        
        if (searchableText.includes(normalizedQuery)) {
            results.push(id);
        }
    });
    
    return results;
}

window.drugDatabase = drugDatabase;
window.searchDrugs = searchDrugs;
