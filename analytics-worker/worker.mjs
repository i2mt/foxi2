const EVENT_NAMES = new Set(['launch', 'pwa_installed', 'pwa_first_seen', 'tab_view', 'feature_used']);
const FEATURES = new Set([
    'calculator', 'drug_reference', 'clinical_tools', 'voice_assistant',
    'infusion_calculation', 'reverse_infusion', 'manual_infusion',
    'voice_spoken', 'voice_typed', 'bmi', 'bsa', 'ibw', 'crcl',
    'dose_calculator', 'compatibility', 'gcs', 'burns', 'rass',
    'braden', 'morse', 'oxygen', 'ventilator', 'nutrition', 'vbg'
]);
const DISPLAY_MODES = new Set(['browser', 'standalone', 'minimal-ui']);
const PLATFORMS = new Set(['ios', 'android', 'windows', 'macos', 'linux', 'other']);
const BROWSERS = new Set(['chrome-ios', 'firefox-ios', 'edge', 'opera', 'chrome', 'safari', 'firefox', 'other']);
const ID_RE = /^[a-f0-9-]{16,64}$/i;
const VERSION_RE = /^[0-9]{1,3}(?:\.[0-9]{1,3}){1,3}$/;

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...extraHeaders
        }
    });
}

function allowedOrigin(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    return allowed.includes(origin) ? origin : '';
}

function corsHeaders(origin) {
    return origin ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    } : {};
}

function isValidEvent(item) {
    if (!item || typeof item !== 'object') return false;
    if (!ID_RE.test(String(item.id || '')) || !ID_RE.test(String(item.visitor_id || '')) || !ID_RE.test(String(item.session_id || ''))) return false;
    if (!EVENT_NAMES.has(item.event) || !VERSION_RE.test(String(item.app_version || ''))) return false;
    if (!DISPLAY_MODES.has(item.display_mode) || !PLATFORMS.has(item.platform) || !BROWSERS.has(item.browser)) return false;
    if ((item.event === 'tab_view' || item.event === 'feature_used') && !FEATURES.has(item.feature)) return false;
    if (item.feature != null && !FEATURES.has(item.feature)) return false;
    return typeof item.online === 'boolean';
}

function authorized(request, env) {
    const header = request.headers.get('Authorization') || '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expected = String(env.ADMIN_TOKEN || '');
    if (!supplied || !expected || supplied.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < supplied.length; i++) difference |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
    return difference === 0;
}

async function ingest(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: 'origin_not_allowed' }, 403);
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > 32768) return json({ error: 'payload_too_large' }, 413, corsHeaders(origin));

    let body;
    try { body = JSON.parse(await request.text()); }
    catch (error) { return json({ error: 'invalid_json' }, 400, corsHeaders(origin)); }

    const events = Array.isArray(body.events) ? body.events : [];
    if (!events.length || events.length > 20 || events.some(item => !isValidEvent(item))) {
        return json({ error: 'invalid_events' }, 400, corsHeaders(origin));
    }

    const now = Math.floor(Date.now() / 1000);
    const eventDate = new Date(now * 1000).toISOString().slice(0, 10);
    const country = /^[A-Z]{2}$/.test(String(request.cf && request.cf.country || '')) ? request.cf.country : 'XX';
    const statements = events.map(item => env.DB.prepare(`
        INSERT OR IGNORE INTO analytics_events
        (id, received_at, event_date, visitor_id, session_id, event_name, feature, app_version, display_mode, platform, browser, country, was_online)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        item.id, now, eventDate, item.visitor_id, item.session_id, item.event,
        item.feature || null, item.app_version, item.display_mode, item.platform,
        item.browser, country, item.online ? 1 : 0
    ));
    await env.DB.batch(statements);
    return json({ ok: true, accepted: events.length }, 202, corsHeaders(origin));
}

async function stats(request, env) {
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
    const url = new URL(request.url);
    const requestedDays = Number(url.searchParams.get('days') || 30);
    const days = [7, 30, 90, 180].includes(requestedDays) ? requestedDays : 30;
    const since = Math.floor(Date.now() / 1000) - (days * 86400);

    const [summary, returning, newUsers, daily, features, tabs, platforms, browsers, countries, versions] = await Promise.all([
        env.DB.prepare(`SELECT
            COUNT(DISTINCT visitor_id) AS active_users,
            COUNT(DISTINCT session_id) AS sessions,
            COUNT(DISTINCT CASE WHEN display_mode = 'standalone' THEN visitor_id END) AS pwa_users,
            COUNT(DISTINCT CASE WHEN event_name IN ('pwa_installed','pwa_first_seen') THEN visitor_id END) AS observed_installs,
            SUM(CASE WHEN event_name = 'feature_used' THEN 1 ELSE 0 END) AS feature_uses,
            COUNT(*) AS total_events
            FROM analytics_events WHERE received_at >= ?`).bind(since).first(),
        env.DB.prepare(`SELECT COUNT(*) AS returning_users FROM (
            SELECT visitor_id FROM analytics_events WHERE received_at >= ?
            GROUP BY visitor_id HAVING COUNT(DISTINCT session_id) > 1
        )`).bind(since).first(),
        env.DB.prepare(`SELECT COUNT(*) AS new_users FROM (
            SELECT visitor_id, MIN(received_at) AS first_seen FROM analytics_events GROUP BY visitor_id
            HAVING first_seen >= ?
        )`).bind(since).first(),
        env.DB.prepare(`SELECT event_date AS day,
            COUNT(DISTINCT visitor_id) AS users,
            COUNT(DISTINCT session_id) AS sessions,
            SUM(CASE WHEN event_name = 'feature_used' THEN 1 ELSE 0 END) AS uses
            FROM analytics_events WHERE received_at >= ? GROUP BY event_date ORDER BY event_date`).bind(since).all(),
        env.DB.prepare(`SELECT feature AS label, COUNT(*) AS value FROM analytics_events
            WHERE received_at >= ? AND event_name = 'feature_used' GROUP BY feature ORDER BY value DESC`).bind(since).all(),
        env.DB.prepare(`SELECT feature AS label, COUNT(*) AS value FROM analytics_events
            WHERE received_at >= ? AND event_name = 'tab_view' GROUP BY feature ORDER BY value DESC`).bind(since).all(),
        env.DB.prepare(`SELECT platform AS label, COUNT(DISTINCT visitor_id) AS value FROM analytics_events
            WHERE received_at >= ? GROUP BY platform ORDER BY value DESC`).bind(since).all(),
        env.DB.prepare(`SELECT browser AS label, COUNT(DISTINCT visitor_id) AS value FROM analytics_events
            WHERE received_at >= ? GROUP BY browser ORDER BY value DESC`).bind(since).all(),
        env.DB.prepare(`SELECT country AS label, COUNT(DISTINCT visitor_id) AS value FROM analytics_events
            WHERE received_at >= ? GROUP BY country ORDER BY value DESC LIMIT 15`).bind(since).all(),
        env.DB.prepare(`SELECT app_version AS label, COUNT(DISTINCT visitor_id) AS value FROM analytics_events
            WHERE received_at >= ? GROUP BY app_version ORDER BY value DESC`).bind(since).all()
    ]);

    return json({
        days,
        generated_at: new Date().toISOString(),
        summary: { ...summary, ...returning, ...newUsers },
        daily: daily.results || [],
        features: features.results || [],
        tabs: tabs.results || [],
        platforms: platforms.results || [],
        browsers: browsers.results || [],
        countries: countries.results || [],
        versions: versions.results || []
    });
}

function dashboard() {
    return new Response(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>آمار FoxiMed</title><style>
    :root{color-scheme:dark;--bg:#0f172a;--card:#172033;--line:#2a3850;--text:#f8fafc;--muted:#9fb0c8;--fox:#f97316;--gold:#fbbf24}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#253249,var(--bg) 42%);color:var(--text);font-family:Tahoma,Arial,sans-serif;min-height:100vh}.wrap{max-width:1180px;margin:auto;padding:28px 18px 60px}header{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:22px}h1{margin:0;font-size:26px}small,.muted{color:var(--muted)}button,select,input{font:inherit;border:1px solid var(--line);border-radius:12px;background:#10192a;color:var(--text);padding:10px 13px}button{background:linear-gradient(135deg,var(--fox),#ea580c);border:0;font-weight:700;cursor:pointer}.login{max-width:430px;margin:12vh auto;background:var(--card);padding:26px;border:1px solid var(--line);border-radius:20px}.login input{width:100%;margin:14px 0}.toolbar{display:flex;gap:9px;align-items:center}.cards{display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:12px}.card,.panel{background:linear-gradient(145deg,rgba(29,41,62,.96),rgba(20,30,48,.96));border:1px solid var(--line);border-radius:17px;padding:16px}.card span{display:block;color:var(--muted);font-size:13px}.card strong{display:block;font-size:29px;margin-top:9px}.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:14px;margin-top:14px}.panel h2{font-size:16px;margin:0 0 14px}.bars{display:flex;gap:5px;height:180px;align-items:end;border-bottom:1px solid var(--line);padding-top:12px}.bar{flex:1;min-width:3px;background:linear-gradient(var(--gold),var(--fox));border-radius:5px 5px 0 0;position:relative}.bar:hover:after{content:attr(data-tip);position:absolute;bottom:100%;right:50%;transform:translateX(50%);background:#050a13;padding:6px 8px;border-radius:7px;white-space:nowrap;font-size:11px;z-index:2}.row{display:grid;grid-template-columns:minmax(120px,1fr) 3fr 45px;gap:10px;align-items:center;margin:9px 0;font-size:13px}.track{height:8px;background:#0b1220;border-radius:10px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,var(--fox),var(--gold));border-radius:10px}.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}.error{color:#fecaca;background:#451a1a;padding:12px;border-radius:12px}@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.grid,.split{grid-template-columns:1fr}}@media(max-width:480px){.cards{grid-template-columns:1fr 1fr}.card strong{font-size:23px}}
    </style></head><body><div class="wrap"><section class="login" id="login"><h1>داشبورد آمار FoxiMed</h1><p class="muted">رمز مدیریتی فقط در همین مرورگر و در حافظهٔ موقت نگه‌داری می‌شود.</p><input id="token" type="password" autocomplete="current-password" placeholder="رمز مدیریتی"><button id="loginBtn">نمایش آمار</button><p id="loginError"></p></section><main id="app" hidden><header><div><h1>آمار ناشناس FoxiMed</h1><small id="updated"></small></div><div class="toolbar"><select id="days"><option value="7">۷ روز</option><option value="30" selected>۳۰ روز</option><option value="90">۹۰ روز</option><option value="180">۱۸۰ روز</option></select><button id="refresh">به‌روزرسانی</button></div></header><section class="cards" id="cards"></section><section class="grid"><div class="panel"><h2>کاربران فعال روزانه</h2><div class="bars" id="daily"></div></div><div class="panel"><h2>پراستفاده‌ترین قابلیت‌ها</h2><div id="features"></div></div><div class="panel"><h2>بازدید بخش‌های برنامه</h2><div id="tabs"></div></div><div class="panel"><h2>دستگاه و مرورگر</h2><div class="split"><div id="platforms"></div><div id="browsers"></div></div></div><div class="panel"><h2>کشورها</h2><div id="countries"></div></div><div class="panel"><h2>نسخه‌های فعال</h2><div id="versions"></div></div></section></main></div><script>
    const labels={calculator:'محاسبه‌گر',drug_reference:'مرجع دارو',clinical_tools:'ابزارهای بالینی',voice_assistant:'دستیار',infusion_calculation:'محاسبه انفوزیون',reverse_infusion:'محاسبه معکوس',manual_infusion:'محاسبه دستی',voice_spoken:'فرمان صوتی',voice_typed:'فرمان تایپی',bmi:'BMI',bsa:'BSA',ibw:'IBW',crcl:'CrCl',dose_calculator:'محاسبه دوز',compatibility:'سازگاری دارویی',ios:'iOS',android:'Android',windows:'Windows',macos:'macOS',linux:'Linux',chrome:'Chrome',safari:'Safari',edge:'Edge',firefox:'Firefox','chrome-ios':'Chrome iOS','firefox-ios':'Firefox iOS',other:'سایر'};let token=sessionStorage.getItem('foximedAdmin')||'';const n=v=>Number(v||0).toLocaleString('fa-IR');function rows(id,data){const root=document.getElementById(id),max=Math.max(1,...data.map(x=>Number(x.value)));root.innerHTML=data.length?data.map(x=>'<div class="row"><span>'+String(labels[x.label]||x.label)+'</span><div class="track"><div class="fill" style="width:'+Math.round(Number(x.value)/max*100)+'%"></div></div><strong>'+n(x.value)+'</strong></div>').join(''):'<p class="muted">هنوز داده‌ای ثبت نشده است.</p>'}async function load(){const days=document.getElementById('days').value;const r=await fetch('/v1/stats?days='+days,{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!r.ok)throw new Error(r.status===401?'رمز نادرست است.':'خطا در دریافت آمار');const d=await r.json();sessionStorage.setItem('foximedAdmin',token);document.getElementById('login').hidden=true;document.getElementById('app').hidden=false;document.getElementById('updated').textContent='آخرین دریافت: '+new Date(d.generated_at).toLocaleString('fa-IR');const s=d.summary;const cards=[['کاربران فعال',s.active_users],['نشست‌ها',s.sessions],['کاربران PWA',s.pwa_users],['نصب مشاهده‌شده',s.observed_installs],['کاربران بازگشتی',s.returning_users],['استفاده از قابلیت‌ها',s.feature_uses]];document.getElementById('cards').innerHTML=cards.map(x=>'<div class="card"><span>'+x[0]+'</span><strong>'+n(x[1])+'</strong></div>').join('');const max=Math.max(1,...d.daily.map(x=>Number(x.users)));document.getElementById('daily').innerHTML=d.daily.map(x=>'<div class="bar" style="height:'+Math.max(3,Math.round(Number(x.users)/max*100))+'%" data-tip="'+x.day+' — '+n(x.users)+' کاربر"></div>').join('');rows('features',d.features);rows('tabs',d.tabs);rows('platforms',d.platforms);rows('browsers',d.browsers);rows('countries',d.countries);rows('versions',d.versions)}async function enter(){token=document.getElementById('token').value||token;try{await load();document.getElementById('loginError').textContent=''}catch(e){document.getElementById('loginError').className='error';document.getElementById('loginError').textContent=e.message}}document.getElementById('loginBtn').onclick=enter;document.getElementById('token').onkeydown=e=>{if(e.key==='Enter')enter()};document.getElementById('refresh').onclick=load;document.getElementById('days').onchange=load;if(token)enter();
    </script></body></html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS' && url.pathname === '/v1/events') {
            const origin = allowedOrigin(request, env);
            return origin ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : new Response(null, { status: 403 });
        }
        if (request.method === 'POST' && url.pathname === '/v1/events') return ingest(request, env);
        if (request.method === 'GET' && url.pathname === '/v1/stats') return stats(request, env);
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) return dashboard();
        return json({ error: 'not_found' }, 404);
    }
};

