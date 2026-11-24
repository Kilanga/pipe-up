// End-to-end check, run with: node test/e2e/network.mjs  (after `npm run build`).
// What the hosted demo contacts, and when; the response headers of firebase.json;
// what happens when the cloud refuses; and which briefing may reach the cloud.
// Nothing leaves this computer: every outside request is recorded and answered here.
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = Number(process.env.PORT) || 8135;
const { fakeNano } = await import('./fake-nano.mjs');

// The local server sends the headers that Firebase Hosting will send (firebase.json, source "**").
const HEADERS = Object.fromEntries(JSON.parse(readFileSync(REPO + 'firebase.json', 'utf8')).hosting.headers.find((h) => h.source === '**').headers.map((h) => [h.key, h.value]));
const root = REPO + 'dist/demo';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html'; if (!existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', ...HEADERS }); s.end(readFileSync(f)); }).listen(PORT);
const URL_ = `http://localhost:${PORT}/`;

const R = []; const ok = (name, cond, extra = '') => R.push(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`);
const errs = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// A stand-in for reCAPTCHA Enterprise's script: it only hands a made-up token to the SDK.
const FAKE_RECAPTCHA = `{ let done; window.grecaptcha = { enterprise: { ready: (f) => f(), render: (el, o) => ((done = o.callback), 'w'), execute: async () => (done(), 'fake-recaptcha-token') } }; }`;
const REPLIES = JSON.stringify({ replies: [{ text: 'Signed, except the penalty clause.', source: 'briefing' }, { text: 'Which clause do you mean?', source: 'general' }, { text: 'Let me check and get back to you.', source: 'general' }] });
const SSE = `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: REPLIES }] }, finishReason: 'STOP' }] })}\r\n\r\n`;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

/** A page whose outside requests are all recorded and answered locally. `world.appCheck`: 'ok' | 'refuse'. */
async function open(world, { nano = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const net = []; const csp = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to|Permissions policy|Unrecognized feature/i.test(t)) csp.push(t.slice(0, 220));
    else if (m.type() === 'error' && !/status of 40[03]/.test(t)) errs.push('console ' + t.slice(0, 200));
  });
  if (nano) await page.addInitScript(fakeNano);
  await ctx.route('**/*', (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.host === `localhost:${PORT}`) return r.continue();
    net.push({ host: u.host, path: u.pathname, method: req.method(), body: req.postData() || '', appCheck: req.headers()['x-firebase-appcheck'] || '' });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (u.host === 'www.google.com' && u.pathname.startsWith('/recaptcha/')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_RECAPTCHA });
    if (u.host === 'content-firebaseappcheck.googleapis.com') {
      return world.appCheck === 'ok'
        ? r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ token: 'fake-app-check-token', ttl: '3600s' }) })
        : r.fulfill({ status: 403, contentType: 'application/json', headers: CORS, body: JSON.stringify({ error: { code: 403, message: 'App attestation failed.', status: 'PERMISSION_DENIED' } }) });
    }
    if (u.host === 'firebasevertexai.googleapis.com') return r.fulfill({ status: 200, contentType: 'text/event-stream', headers: CORS, body: SSE });
    // Firebase Installations and Remote Config: a made-up installation, and "no template" (the bundled defaults are used).
    if (u.host === 'firebaseinstallations.googleapis.com') return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ name: 'projects/0/installations/fake', fid: 'fakeFid0000000000000000', refreshToken: 'fake', authToken: { token: 'fake', expiresIn: '604800s' } }) });
    if (u.host === 'firebaseremoteconfig.googleapis.com') return r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ state: 'NO_TEMPLATE' }) });
    return r.abort();
  });
  const recaptcha = () => net.filter((n) => /recaptcha/.test(n.host + n.path));
  const exchanges = () => net.filter((n) => /firebaseappcheck/.test(n.host));
  const cloud = () => net.filter((n) => n.host === 'firebasevertexai.googleapis.com' && n.method === 'POST');
  const prompts = () => cloud().map((c) => JSON.parse(c.body).contents.map((x) => x.parts.map((p) => p.text).join('')).join('\n'));
  const ov = () => page.evaluate(() => { const r = document.querySelector('#pipe-up-overlay').shadowRoot; return { cards: [...r.querySelectorAll('.card')].map((c) => c.textContent), badge: r.querySelector('.badge').textContent, notice: r.querySelector('.notice').hidden ? '' : r.querySelector('.notice').textContent, radius: getComputedStyle(r.querySelector('.pu')).borderRadius }; });
  const say = async (t, wait = 3500) => { await page.fill('#sayText', t); await page.keyboard.press('Enter'); await page.waitForTimeout(wait); };
  const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('pu-settings') || '{}'));
  return { ctx, page, net, csp, recaptcha, exchanges, cloud, prompts, ov, say, settings };
}

// ---- 1. A visit that stays on the device: no reCAPTCHA, no App Check, under the new headers ----
{
  const world = { appCheck: 'ok' };
  const v = await open(world, { nano: true });
  await v.page.goto(URL_); await v.page.waitForTimeout(3500);
  const hosts = [...new Set(v.net.map((n) => n.host))];
  ok('page load: Firebase Installations / Remote Config only', hosts.every((h) => /^firebase(installations|remoteconfig)\.googleapis\.com$/.test(h)), hosts.join(', ') || 'no outside request');
  ok('page load: no reCAPTCHA request and no App Check exchange', v.recaptcha().length === 0 && v.exchanges().length === 0);
  ok('page load: no reCAPTCHA script or frame in the page', await v.page.evaluate(() => !document.querySelector('script[src*="recaptcha"], iframe, #fire_app_check_[DEFAULT]') && !window.grecaptcha));
  await v.page.click('#sample'); await v.page.waitForTimeout(3000);
  await v.page.click('#next'); await v.page.waitForTimeout(3500);
  let o = await v.ov();
  ok('headers: suggestions on device, panel styled (inline styles allowed)', o.cards.length === 3 && o.badge === 'On device' && o.radius === '14px', `${o.badge} ${o.radius}`);
  // a whole call on the device, a preparation on the device, a PDF, the voice: still nothing for reCAPTCHA
  await v.page.click('#prep'); await v.page.getByRole('button', { name: 'Prepare on this computer' }).click(); await v.page.waitForTimeout(1500);
  ok('headers: "Prepare for the call" on this computer works', (await v.page.locator('section.prep ol.qa li').count()) === 2);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 18 Tf 20 100 Td (Budget approved: 40k euros.) Tj ET'; objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n'; const offs = []; objs.forEach((x, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${x}\nendobj\n`; }); const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const PDF = tmpdir() + '/pipe-up-csp.pdf'; writeFileSync(PDF, pdf);
  await v.page.locator('#pu-pane-Briefing input[type=file]').setInputFiles(PDF); await v.page.waitForTimeout(2500);
  const docText = await v.page.locator('#pu-pane-Briefing textarea[aria-label="Text extracted from your document"]').inputValue();
  ok('headers: a PDF is read (pdf.js worker allowed)', /Budget approved: 40k euros/.test(docText), docText.slice(0, 40));
  // the voice: only a voice installed on this computer may speak (never the browser's default, which can be an online one)
  await v.page.evaluate(() => {
    window.__spoken = [];
    const voices = [{ name: 'Online', lang: 'en-US', localService: false, default: true }, { name: 'Local', lang: 'en-US', localService: true, default: false }];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } }; // accepts the stand-in voices
    speechSynthesis.getVoices = () => voices; speechSynthesis.cancel = () => {};
    speechSynthesis.speak = (u) => window.__spoken.push({ voice: u.voice?.name || '(browser default)', local: Boolean(u.voice?.localService), text: u.text });
  });
  // real keys on the list: the panel ignores events made by scripts (Playwright's selectOption is one)
  const output = v.page.locator('#pipe-up-overlay select');
  await output.focus(); await v.page.keyboard.press('ArrowDown'); await v.page.waitForTimeout(200);
  ok('demo voice: "Chat + synthetic voice" chosen with real keys', (await output.inputValue()) === 'chat+voice' && (await v.settings()).outputMode === 'chat+voice', await output.inputValue());
  await v.page.locator('body').click({ position: { x: 5, y: 880 } });
  await v.page.keyboard.press('Alt+1'); await v.page.waitForTimeout(300);
  let spoken = await v.page.evaluate(() => window.__spoken);
  ok('demo voice: the reply is read with a local voice, never the default online one', spoken.length === 1 && spoken[0].voice === 'Local' && spoken[0].local, JSON.stringify(spoken));
  await v.page.evaluate(() => { window.__spoken = []; speechSynthesis.getVoices = () => [{ name: 'Online', lang: 'en-US', localService: false, default: true }]; });
  await output.focus(); await v.page.keyboard.press('ArrowDown'); await v.page.waitForTimeout(200);
  await v.page.locator('body').click({ position: { x: 5, y: 880 } });
  await v.page.keyboard.press('Alt+2'); await v.page.waitForTimeout(300);
  spoken = await v.page.evaluate(() => window.__spoken);
  ok('demo voice: with online voices only, nothing is spoken and the reply goes to the chat', spoken.length === 0 && /Could you repeat that/.test(await v.page.locator('#chat li').last().innerText()) && /No voice installed/.test((await v.ov()).notice), (await v.ov()).notice);
  ok('on-device visit: still no reCAPTCHA, App Check or Gemini API request', v.recaptcha().length === 0 && v.exchanges().length === 0 && v.cloud().length === 0, [...new Set(v.net.map((n) => n.host))].join(', '));
  ok('headers: no CSP or Permissions-Policy violation on the device path', v.csp.length === 0, v.csp.join(' | '));
  const h = await (await v.page.request.get(URL_)).headers();
  ok('headers: frame, sniffing and referrer protections are sent', h['x-frame-options'] === 'DENY' && h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'no-referrer' && /frame-ancestors 'none'/.test(h['content-security-policy']) && /camera=\(\)/.test(h['permissions-policy']));
  await v.ctx.close();
}

// ---- 2. No Gemini Nano: the cloud is asked only after the click, with a token obtained then ----
{
  const world = { appCheck: 'ok' };
  const v = await open(world);
  await v.page.goto(URL_); await v.page.waitForTimeout(3000);
  await v.page.click('#sample'); await v.page.waitForTimeout(3000);
  const banner = await v.page.locator('#nano-banner').innerText();
  ok('banner: says why, what is sent and that reCAPTCHA sets a cookie', /Gemini Nano/.test(banner) && /last two caption lines/.test(banner) && /reCAPTCHA checks this browser first \(it sets a cookie\)/.test(banner) && /Sam's briefing is fictional/.test(banner), banner.split('\n')[0].slice(0, 80));
  await v.page.click('#next'); await v.page.waitForTimeout(3500);
  ok('before consent: basic replies, nothing for reCAPTCHA, App Check or the Gemini API', (await v.ov()).badge !== 'Cloud' && v.recaptcha().length + v.exchanges().length + v.cloud().length === 0);
  await v.page.click('#try-cloud'); await v.page.waitForTimeout(1500);
  ok('consent alone asks for no token: App Check waits for a real cloud request', v.recaptcha().length + v.exchanges().length === 0);
  await v.say('Is the penalty clause of the vendor contract signed?');
  let o = await v.ov();
  ok('first cloud need: reCAPTCHA loaded, one limited-use token exchanged, sent with the request', v.recaptcha().length === 1 && v.exchanges().length === 1 && /"limited_use":true/.test(v.exchanges()[0].body) && v.cloud().length === 1 && v.cloud()[0].appCheck === 'fake-app-check-token', `${v.recaptcha().length} script, ${v.exchanges().length} exchange, ${v.cloud().length} request`);
  ok('cloud reply shown, tagged only where it overlaps the briefing', o.badge === 'Cloud' && /Signed, except the penalty clause\.From your briefing/.test(o.cards[0]) && !/From your briefing/.test(o.cards[1]), o.cards[0]);
  let p = v.prompts().at(-1) || '';
  const talk = p.slice(p.indexOf('CONVERSATION')); // (the sample briefing itself mentions Maya)
  ok('cloud prompt: neutral speaker labels, no display name', /Speaker A: <<<[^\n]*\nSpeaker A: <<<Is the penalty/.test(talk) && !/Maya|Jordan/.test(talk), talk.split('\n').slice(1, 3).join(' / ').slice(0, 120));
  ok("cloud prompt: Sam's fictional sample is shared automatically", /MY POSITIONS/.test(p) && /penalty clause; legal reviews it on Friday/.test(p));
  ok('headers: no CSP violation on the cloud path (reCAPTCHA stand-in; real reCAPTCHA to re-test after deployment)', v.csp.length === 0, v.csp.join(' | '));
  // the user makes the briefing their own: automatic sharing stops and it is said
  await v.page.click('#pu-tab-Briefing');
  await v.page.locator('label.field', { hasText: 'My positions' }).locator('textarea').fill('REAL-SECRET: our maximum budget is 40k euros for the vendor contract penalty clause.');
  await v.page.getByRole('button', { name: 'Save briefing' }).click(); await v.page.waitForTimeout(400);
  let cfg = await v.settings();
  const note = await v.page.locator('#share-note').innerText();
  ok('own briefing: sharing is turned off, and the page says so', cfg.cloudConsent === true && cfg.shareBriefingWithCloud === false && /no longer Sam's sample, so it is not sent to the cloud any more/.test(note), note.slice(0, 90));
  await v.page.click('#pu-tab-Live');
  ok('own briefing: the "send briefing excerpts" box is unticked', !(await v.page.locator('label.check', { hasText: 'Also send relevant briefing excerpts' }).locator('input').isChecked()));
  await v.say('What is our maximum budget for the vendor contract penalty clause?');
  p = v.prompts().at(-1) || '';
  ok('own briefing: the next cloud request carries the caption lines only', v.cloud().length === 2 && !/REAL-SECRET|40k|MY POSITIONS|BRIEFING/.test(p), p.split('\n')[0]);
  // explicit opt-in: the user's own choice is kept, also after another edit
  await v.page.locator('label.check', { hasText: 'Also send relevant briefing excerpts' }).locator('input').check(); await v.page.waitForTimeout(200);
  await v.page.click('#pu-tab-Briefing');
  await v.page.locator('label.field', { hasText: 'Write or paste your notes' }).locator('textarea').fill('Another note about the vendor.');
  await v.page.getByRole('button', { name: 'Save briefing' }).click(); await v.page.waitForTimeout(400);
  await v.say('What is our maximum budget for the vendor contract penalty clause?');
  p = v.prompts().at(-1) || ''; cfg = await v.settings();
  ok('explicit opt-in: the briefing is sent because the user chose it, and the choice is kept', cfg.shareBriefingWithCloud === true && /REAL-SECRET/.test(p));
  // a document added while the sample is shared automatically: same rule
  await v.page.evaluate(() => { localStorage.clear(); }); await v.page.reload(); await v.page.waitForTimeout(2000);
  await v.page.click('#sample'); await v.page.waitForTimeout(3000);
  await v.page.click('#try-cloud'); await v.page.waitForTimeout(300);
  ok('sample briefing: automatic sharing is on after "Try with the cloud"', (await v.settings()).shareBriefingWithCloud === true && (await v.settings()).demoAutoShare === true);
  const NOTES = tmpdir() + '/pipe-up-own.txt'; writeFileSync(NOTES, 'REAL-DOCUMENT: the launch is on April 3.');
  await v.page.click('#pu-tab-Briefing');
  await v.page.locator('#pu-pane-Briefing input[type=file]').setInputFiles(NOTES); await v.page.waitForTimeout(800);
  await v.page.getByRole('button', { name: 'Save briefing' }).click(); await v.page.waitForTimeout(400);
  ok('a document is added: sharing is turned off', (await v.settings()).shareBriefingWithCloud === false && await v.page.locator('#share-note').isVisible());
  await v.ctx.close();
}

// ---- 3. An own briefing is never shared by "Try with the cloud" ----
{
  const v = await open({ appCheck: 'ok' });
  await v.page.addInitScript(() => { if (!localStorage.getItem('pu-briefing')) localStorage.setItem('pu-briefing', JSON.stringify({ positions: 'REAL-SECRET: we can go up to 40k euros for the vendor contract.', notes: '' })); });
  await v.page.goto(URL_); await v.page.waitForTimeout(3000);
  const banner = await v.page.locator('#nano-banner').innerText();
  ok('own briefing: the banner says it is not sent', /Your briefing is not sent/.test(banner), banner.slice(-110));
  await v.page.click('#try-cloud'); await v.page.waitForTimeout(300);
  await v.say('How far can we go for the vendor contract?');
  const cfg = await v.settings();
  ok('own briefing: "Try with the cloud" allows the cloud without sharing the briefing', cfg.cloudConsent === true && cfg.shareBriefingWithCloud === false && v.cloud().length === 1 && !/REAL-SECRET|40k/.test(v.prompts()[0]));
  await v.ctx.close();
}

// ---- 4. App Check refuses: a calm message, basic replies, and no storm of retries ----
{
  const world = { appCheck: 'refuse' };
  const v = await open(world);
  await v.page.goto(URL_); await v.page.waitForTimeout(3000);
  await v.page.click('#try-cloud'); await v.page.waitForTimeout(300);
  await v.say('Is the vendor contract signed?', 4500);
  let o = await v.ov();
  ok('cloud refused: basic replies and a clear, calm message in the call panel', o.cards.length === 3 && o.badge === 'Basic replies' && o.notice === 'The cloud could not answer this time. These are basic replies. You can still write your own.', o.notice);
  const live = await v.page.locator('#pu-pane-Live .cloud-note').innerText();
  ok('cloud refused: the Live tab keeps the message', /^The cloud could not answer this time\. These are basic replies\./.test(live), live);
  ok('cloud refused: no request reached the Gemini API without a token', v.cloud().length === 0 && v.exchanges().length === 1);
  await v.say('And the March deadline?', 4500);
  o = await v.ov();
  ok('cloud refused again: the SDK backs off (no second exchange) and the same calm message is shown', v.exchanges().length === 1 && /The cloud could not answer this time/.test(o.notice) && o.cards.length === 3, `${v.exchanges().length} exchange(s) | ${o.notice}`);
  await v.ctx.close();
}

// ---- 5. "Simulate a computer without Gemini Nano": the banner the notice points to is there ----
{
  const v = await open({ appCheck: 'ok' }, { nano: true });
  await v.page.goto(URL_); await v.page.waitForTimeout(3000);
  ok('Gemini Nano there: no banner', await v.page.locator('#nano-banner').isHidden());
  await v.page.locator('label.check', { hasText: 'simulate a computer without Gemini Nano' }).locator('input').check(); await v.page.waitForTimeout(400);
  const banner = await v.page.locator('#nano-banner').innerText();
  ok('simulate: the banner appears and says it is a simulation', await v.page.locator('#try-cloud').isVisible() && /You are simulating a computer without Gemini Nano/.test(banner), banner.slice(0, 60));
  await v.say('Any news?');
  ok('simulate: the notice points to a button that is visible', /Use "Try with the cloud" above/.test((await v.ov()).notice) && await v.page.locator('#try-cloud').isVisible());
  await v.ctx.close();
}

console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
// A failed check or an unexpected error makes the script fail (CI, pre-commit).
if (R.some((l) => l.startsWith('FAIL')) || errs.length) process.exitCode = 1;
await browser.close(); srv.close();
