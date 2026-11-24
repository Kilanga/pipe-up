// End-to-end check, run with: node test/e2e/demo.mjs  (after `npm run build`).
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = Number(process.env.PORT) || 8130;
const { fakeNano, fakeCloud, prepReply } = await import('./fake-nano.mjs');
import { tmpdir as _tmp } from 'node:os';
const NOTES = _tmp() + '/pipe-up-notes.txt';
import http from 'node:http'; import { readFileSync, existsSync, writeFileSync } from 'node:fs'; import path from 'node:path';
const root = REPO + 'dist/demo';
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css' };
const srv = http.createServer((q,s)=>{ let f=path.join(root, decodeURIComponent(q.url.split('?')[0])); if(f.endsWith('/')) f+='index.html'; if(!existsSync(f)){s.writeHead(404);return s.end();} s.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); s.end(readFileSync(f)); }).listen(PORT);
const browser = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
let refuse0 = false; // true: the fake cloud refuses the request (403), which Chrome reports in the console
const errs=[]; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); page.on('console', m => m.type()==='error' && !(refuse0 && /status of 403/.test(m.text())) && !/report-only Content Security Policy/.test(m.text()) && errs.push('console ' + m.text().slice(0,200)));
const R = []; const ok = (name, cond, extra='') => R.push(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`);
// The "Prepare for the call" section of a page.
const prep = (pg) => ({
  section: pg.locator('section.prep'),
  cloudBtn: pg.getByRole('button', { name: 'Prepare with the cloud' }),
  deviceBtn: pg.getByRole('button', { name: 'Prepare on this computer' }),
  confirm: pg.locator('section.prep .confirm'),
  status: pg.locator('section.prep [role=status]'),
  rows: pg.locator('section.prep ol.qa li'),
  log: async () => { await pg.click('#pu-tab-Live'); const t = await pg.locator('.log').innerText(); await pg.click('#pu-tab-Briefing'); return t; },
  stored: () => pg.evaluate(() => JSON.parse(localStorage.getItem('pu-briefing') || '{}').prepared || []),
  settings: () => pg.evaluate(() => JSON.parse(localStorage.getItem('pu-settings') || '{}')),
  overlay: () => pg.evaluate(() => { const r = document.querySelector('#pipe-up-overlay')?.shadowRoot; return { cards: [...r.querySelectorAll('.card')].map(c => c.textContent), badge: r.querySelector('.badge').textContent }; }),
});
const ov = () => page.evaluate(() => { const r = document.querySelector('#pipe-up-overlay')?.shadowRoot; return { cards: [...r.querySelectorAll('.card')].map(c => c.textContent), sel: [...r.querySelectorAll('.card')].findIndex(c => c.classList.contains('sel')), badge: r.querySelector('.badge').textContent, notice: r.querySelector('.notice')?.hidden ? '' : r.querySelector('.notice')?.textContent, typed: r.querySelector('.typed').value, active: r.activeElement?.tagName || null, status: r.querySelector('[role=status]')?.textContent }; });
const chat = async () => (await page.locator('#chat').innerText()).split('\n').filter(Boolean);
const next = async () => { await page.click('#next'); await page.waitForTimeout(3500); };
const URL_ = `http://localhost:${PORT}/`;
await page.goto(URL_); await page.waitForTimeout(1000);
ok('no "null" text', !(await page.locator('#app').innerText()).includes('null'));
await page.click('#sample'); await page.waitForTimeout(1500);
ok('briefing loaded', (await page.locator('#sample').innerText()).includes('Reload'));
await next(); let o = await ov();
ok('3 cards after first line', o.cards.length === 3, JSON.stringify(o.badge));
await page.keyboard.press('2'); o = await ov(); ok('key 2 selects', o.sel === 1, 'active=' + o.active);
await page.keyboard.press('Enter'); await page.waitForTimeout(300);
let c = await chat(); ok('Enter sends reply 2', c.at(-1)?.includes(o.cards[1].replace(/^2/, '').replace(/From your briefing/, '').trim().slice(0, 15)), c.at(-1));
o = await ov(); ok('cards cleared after send', o.cards.length === 0);
await next(); await page.keyboard.press('1'); await page.keyboard.press('Tab'); o = await ov();
ok('Tab opens edit', o.typed.length > 0 && o.active === 'TEXTAREA', o.typed);
await page.keyboard.type(' today'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
c = await chat(); ok('edited reply sent', c.at(-1)?.endsWith('today'), c.at(-1));
await next(); await page.keyboard.press('4'); await page.waitForTimeout(300);
c = await chat(); ok('key 4 = answered myself', c.at(-1)?.includes('answered out loud'), c.at(-1));
await next(); await page.keyboard.press('Escape'); await page.waitForTimeout(200); o = await ov();
ok('Esc dismisses', o.cards.length === 0, JSON.stringify(o.cards.length));
await page.keyboard.press('Alt+1'); await page.waitForTimeout(300); c = await chat();
ok('Alt+1 filler', c.at(-1)?.includes("I'm still speaking"), c.at(-1));
// typing in Say box: digits must not select
await next(); await page.click('#sayText'); await page.keyboard.type('123'); o = await ov();
ok('digits in a text field do not select', o.sel === -1, 'sel=' + o.sel);
await page.keyboard.press('Enter'); await page.waitForTimeout(3500);
const caps = await page.locator('#captions').innerText(); ok('Say adds a caption', caps.includes('123'));
// Settings: disclosure + Alt+D
await page.click('#pu-tab-Settings');
await page.locator('label.field', { hasText: 'Tell others' }).locator('input').fill('I stutter, thanks for your patience.');
// tick a display option before saving: unsaved text must survive
await page.locator('label.check', { hasText: 'Reduce motion' }).locator('input').check(); await page.waitForTimeout(200);
const disc = await page.locator('label.field', { hasText: 'Tell others' }).locator('input').inputValue();
ok('unsaved field survives a display toggle', disc.startsWith('I stutter'), JSON.stringify(disc));
await page.locator('label.field', { hasText: 'Tell others' }).locator('input').fill('I stutter, thanks for your patience.');
await page.getByRole('button', { name: 'Save settings' }).click(); await page.waitForTimeout(300);
await page.locator('body').click({ position: { x: 5, y: 880 } });
await page.keyboard.press('Alt+d'); await page.waitForTimeout(300); c = await chat();
ok('Alt+D disclosure', c.at(-1)?.includes('I stutter'), c.at(-1));
// on demand mode
await page.click('#pu-tab-Settings');
await page.locator('label.field', { hasText: 'When to suggest' }).locator('select').selectOption('onDemand');
await page.getByRole('button', { name: 'Save settings' }).click(); await page.waitForTimeout(300);
await next(); o = await ov(); ok('on-demand: no cards after pause', o.cards.length === 0, o.notice);
await page.locator('body').click({ position: { x: 5, y: 880 } });
await page.keyboard.press('Alt+s'); await page.waitForTimeout(3000); o = await ov();
ok('Alt+S asks', o.cards.length === 3, String(o.cards.length));
await page.click('#pu-tab-Settings');
await page.locator('label.field', { hasText: 'When to suggest' }).locator('select').selectOption('auto');
await page.getByRole('button', { name: 'Save settings' }).click();
// Memory
await page.click('#pu-tab-Memory'); await page.waitForTimeout(300);
const mem = await page.locator('#pu-pane-Memory').innerText();
ok('memory shows events', /You used a suggestion in \d+ of \d+/.test(mem), mem.split('\n')[2]);
ok('memory has edited event', /Edited|edited/.test(mem));
// Briefing upload
await page.click('#pu-tab-Briefing');
writeFileSync(NOTES, 'Budget: 40k euros approved by finance on Monday.\nThe launch is on April 3.');
await page.locator('#pu-pane-Briefing input[type=file]').setInputFiles(NOTES); await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Save briefing' }).click(); await page.waitForTimeout(300);
const bi = await page.locator('#pu-pane-Briefing [role=status]').first().innerText(); ok('briefing with document', /excerpt/.test(bi), bi);
// Live tab simulate switch + log
await page.click('#pu-tab-Live'); const log = await page.locator('.log').innerText();
ok('routing log filled', log.length > 10, log.split('\n')[0]);
// reload keeps settings and memory
await page.reload(); await page.waitForTimeout(1500);
await page.click('#pu-tab-Settings');
ok('reduce motion kept after reload', await page.locator('label.check', { hasText: 'Reduce motion' }).locator('input').isChecked());

// ---- Prepare for the call on a computer without Gemini Nano (cloud answers faked, see fake-nano.mjs) ----
const cloud0 = await fakeCloud(page, (body) => (refuse0 ? null : prepReply(body)));
const P = prep(page);
await page.click('#prep'); await page.waitForTimeout(300);
ok('demo step 2 opens "Prepare for the call"', await P.section.isVisible() && await P.cloudBtn.evaluate((b) => b === document.activeElement));
ok('no Gemini Nano: "Prepare on this computer" is off, with the reason', await P.deviceBtn.isDisabled() && /needs Gemini Nano/.test(await P.section.innerText()));
await P.cloudBtn.click(); await page.waitForTimeout(200);
let ctext = await P.confirm.innerText();
ok('cloud: the confirmation says plainly what is sent', /This sends your briefing text \(about \d+ words\) to the Gemini API through Firebase, once\./.test(ctext) && /does not turn on the cloud for the call/.test(ctext), ctext.split('\n')[0]);
ok('cloud: nothing is sent before "Continue"', cloud0.length === 0);
await P.confirm.getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(800);
ok('cloud: Cancel sends nothing and gives the focus back', cloud0.length === 0 && await P.confirm.isHidden() && await P.cloudBtn.evaluate((b) => b === document.activeElement));
await P.cloudBtn.click(); await P.confirm.getByRole('button', { name: 'Continue' }).click();
await P.rows.first().waitFor({ timeout: 15000 }).catch(() => {});
ok('cloud: one request, carrying the briefing text', cloud0.length === 1 && cloud0[0].body.includes('Zorvex') && cloud0[0].url.includes(':generateContent'), String(cloud0.length));
ok('cloud: the request used PREFER_IN_CLOUD and JSON schema output', cloud0[0]?.body.includes('responseJsonSchema') && cloud0[0]?.body.includes('"items"'));
ok('cloud: the focus moves to the first prepared question', await P.rows.nth(0).locator('textarea.q').evaluate((i) => i === document.activeElement));
ok('cloud: the prepared answers are listed for review', (await P.rows.count()) === 4 && /Check and edit: these are your answers, in your words\./.test(await P.section.innerText()), String(await P.rows.count()));
let st = await P.status.innerText();
ok('cloud: an answer with an invented number is left out, and it is said', /4 questions prepared with the cloud\. 1 answer was left out/.test(st), st);
let cfg = await P.settings();
ok('cloud: the standing cloud options stay off', !cfg.cloudConsent && !cfg.shareBriefingWithCloud, JSON.stringify([cfg.cloudConsent, cfg.shareBriefingWithCloud]));
let plog = await P.log();
ok('log: "Cloud · preparation · 4 Q&A · n s"', /Cloud · preparation · 4 Q&A · \d+\.\d s/.test(plog) && /sent once to the Gemini API/.test(plog), plog.split('\n')[0]);
ok('briefing status counts the prepared answers', /4 prepared answer/.test(await page.locator('#pu-pane-Briefing [role=status]').first().innerText()));
// review: edit, delete, add; stored on this computer only
await P.rows.nth(0).locator('textarea.a').fill('Signed, except the penalty clause. Legal reviews it on Friday.'); await page.keyboard.press('Tab'); await page.waitForTimeout(200);
ok('edit: stored with the briefing', (await P.stored())[0]?.answer === 'Signed, except the penalty clause. Legal reviews it on Friday.');
await P.rows.nth(3).getByRole('button', { name: 'Delete question 4' }).click(); await page.waitForTimeout(200);
ok('delete: one answer less, focus stays in the section', (await P.rows.count()) === 3 && (await P.stored()).length === 3 && await page.evaluate(() => Boolean(document.activeElement?.closest('section.prep'))));
await page.getByRole('button', { name: 'Add a question' }).click();
ok('add: a new empty question takes the focus', (await P.rows.count()) === 4 && await P.rows.nth(3).locator('textarea.q').evaluate((i) => i === document.activeElement));
await page.keyboard.type('Did you send the risk log?'); await page.keyboard.press('Tab'); await page.keyboard.type('Yes, I sent it to Maya on Monday.'); await page.keyboard.press('Tab'); await page.waitForTimeout(200);
ok('add: stored when both fields are filled', (await P.stored()).length === 4 && (await P.stored())[3].question === 'Did you send the risk log?');
ok('nothing more was sent while editing', cloud0.length === 1);
await page.reload(); await page.waitForTimeout(1500); await page.click('#pu-tab-Briefing');
ok('prepared answers kept after reload', (await P.rows.count()) === 4 && (await P.rows.nth(0).locator('textarea.a').inputValue()).startsWith('Signed, except'));
// during the call, with no model at all: the prepared answer is still offered, from this computer
await next(); o = await ov();
ok('call without any model: the prepared answer comes first, tagged "From your briefing"', o.cards[0]?.includes('Signed, except the penalty clause') && o.cards[0]?.includes('From your briefing') && o.cards.length === 3, o.cards[0]);
ok('call: nothing was sent to the cloud', cloud0.length === 1, String(cloud0.length));
ok('log: "used your prepared answer"', /used your prepared answer/.test(await P.log()));
// the cloud refuses and there is no Gemini Nano: a clear message, the list is kept, the failure is logged
refuse0 = true;
await P.cloudBtn.click(); await P.confirm.getByRole('button', { name: 'Continue' }).click(); await page.waitForTimeout(3000);
ok('after a failure the buttons work again and the focus is back', await P.cloudBtn.isEnabled() && await P.cloudBtn.evaluate((b) => b === document.activeElement));
st = await P.status.innerText(); plog = await P.log();
ok('cloud refused, no Gemini Nano: clear message, answers kept', /^The cloud could not prepare your answers this time\. You can prepare on this computer if Gemini Nano is ready\.$/.test(st) && !/https?:|403/.test(st) && (await P.rows.count()) === 4, st);
ok('log: the failed preparation is listed as not prepared, with the mode that was asked for', /Not prepared · preparation · 0 Q&A/.test(plog.split('\n')[0]) && /\(PREFER_IN_CLOUD\)/.test(plog.split('\n')[1]), plog.split('\n').slice(0, 2).join(' / '));
ok('log: the technical reason is kept as a tooltip, not as text', /403/.test((await page.locator('.log li').first().getAttribute('title')) || '') && !/403/.test(plog));
// deleting the briefing deletes the prepared answers with it
await page.getByRole('button', { name: 'Delete briefing' }).click(); await page.waitForTimeout(300);
ok('delete briefing: prepared answers go with it', (await P.rows.count()) === 0 && (await P.stored()).length === 0 && await P.section.isHidden());

// ---- On-device path, with a stand-in for Gemini Nano (fake-nano.mjs) ----
// The real Firebase AI Logic SDK runs; only Chrome's Prompt API and the network are replaced.
const dev = await browser.newPage({ viewport: { width: 1400, height: 900 } });
let cloudAnswers = true; // false: the fake cloud refuses the request (403), which Chrome reports in the console
dev.on('pageerror', e => errs.push('PAGEERROR(dev) ' + e.message)); dev.on('console', m => m.type()==='error' && !(!cloudAnswers && /status of 403/.test(m.text())) && errs.push('console(dev) ' + m.text().slice(0,200)));
await dev.addInitScript(fakeNano);
const cloud = await fakeCloud(dev, (body) => (cloudAnswers ? prepReply(body) : null));
const nano = () => dev.evaluate(() => JSON.parse(JSON.stringify(window.__nano)));
const dov = () => dev.evaluate(() => { const r = document.querySelector('#pipe-up-overlay')?.shadowRoot; return { cards: [...r.querySelectorAll('.card')].map(c => c.textContent), badge: r.querySelector('.badge').textContent }; });
const sayLine = async (t) => { await dev.fill('#sayText', t); await dev.keyboard.press('Enter'); };
await dev.goto(URL_); await dev.waitForTimeout(3000);
let n = await nano(); const warm = n.prompts.length;
ok('warm-up ran on the fake Gemini Nano', warm === 1 && n.prompts[0].done, JSON.stringify(n.prompts.map(p => p.done)));
// early start: the model is prompted during the short silence, nothing is shown before the pause
let t0 = await dev.evaluate(() => Math.round(performance.now()));
await sayLine('Do we keep the March deadline?'); await dev.waitForTimeout(800);
n = await nano(); o = await dov();
const early = n.prompts[warm];
ok('early start: prompted about 500 ms after the last caption', early && early.at - t0 > 350 && early.at - t0 < 800, early ? `${early.at - t0} ms` : 'no prompt');
ok('early start: nothing shown before the pause', o.cards.length === 0, o.badge);
ok('on-device prompt carries the cancel signal and the JSON schema', early?.hasSignal && early?.hasConstraint);
await dev.waitForTimeout(800); o = await dov(); n = await nano();
ok('early start: shown at the pause, on device', o.cards.length === 3 && o.badge === 'On device' && o.cards[0].includes('March deadline'), o.badge + ' ' + o.cards[0]);
ok('early start: the model ran once', n.prompts.length === warm + 1, String(n.prompts.length - warm));
await dev.click('#pu-tab-Live');
let dlog = await dev.locator('.log').innerText();
ok('log tells the early start', /On device \d+ ms \(started \d+ ms before the pause\)/.test(dlog), dlog.split('\n')[0]);
// captions change during the silence: the early request is cancelled
await sayLine('First question about the budget?'); await dev.waitForTimeout(750);
await sayLine('Second question about the vendor?'); await dev.waitForTimeout(1900);
n = await nano(); o = await dov();
const [first, second] = n.prompts.slice(warm + 1);
ok('captions changed: early request aborted', first?.aborted && !first.done, JSON.stringify(first && { aborted: first.aborted, done: first.done }));
ok('captions changed: the newer question is answered', second?.done && o.cards[0]?.includes('Second question'), o.cards[0]);
// newest wins on a slow model: the running request is aborted
await dev.evaluate(() => (window.__nano.delay = 4000));
await sayLine('Third slow question?'); await dev.waitForTimeout(1900);
await sayLine('Fourth question wins?'); await dev.waitForTimeout(1500);
n = await nano(); const third = n.prompts[warm + 3];
ok('newest wins: the running request is aborted', third?.aborted && !third.done && n.prompts.length === warm + 5, JSON.stringify(n.prompts.slice(warm + 3).map(p => [p.aborted, p.done])));
await dev.evaluate(() => (window.__nano.delay = 300)); await dev.waitForTimeout(600);
ok('on-device path: no cloud request', cloud.length === 0, String(cloud.length));

// ---- Cloud before the call, device during the call ----
const D = prep(dev);
await dev.click('#sample'); await dev.waitForTimeout(3000); // loads Sam's briefing and reloads the page
await dev.click('#prep'); await dev.waitForTimeout(200);
ok('Gemini Nano there: both ways to prepare are offered', await D.cloudBtn.isEnabled() && await D.deviceBtn.isEnabled());
await D.cloudBtn.click(); await D.confirm.getByRole('button', { name: 'Continue' }).click();
await D.rows.first().waitFor({ timeout: 15000 }).catch(() => {});
ok('judge path: "Prepare with the cloud" shows the prepared answers', (await D.rows.count()) === 4 && cloud.length === 1, `${await D.rows.count()} rows, ${cloud.length} request(s)`);
await dev.locator('body').click({ position: { x: 5, y: 880 } });
n = await nano(); let before = n.prompts.length;
await sayLine('Do we still think the March deadline is realistic?'); await dev.waitForTimeout(1900);
n = await nano(); o = await D.overlay();
ok('call: the matching prepared answer is given to Gemini Nano', n.prompts.length === before + 1 && /My prepared answer to "Is the March deadline still realistic\?": Yes, if QA can start on February 10\./.test(n.prompts[before].text));
ok('call: the reply that uses it is tagged "From your briefing", on device', o.badge === 'On device' && o.cards[0]?.includes('Yes, if QA can start on February 10.') && o.cards[0]?.includes('From your briefing'), o.cards[0]);
ok('call: the cloud is not used', cloud.length === 1, String(cloud.length));
ok('log: route and "used your prepared answer"', /On device \d+ ms.*\n.*used your prepared answer/.test(await D.log()));
await sayLine('Did everyone get the slides I sent yesterday?'); await dev.waitForTimeout(1900);
n = await nano();
ok('call: no prepared answer for an unrelated question', !/My prepared answer/.test(n.prompts.at(-1).text));
// the same work on this computer, with a confirmation because it replaces the list
await D.deviceBtn.click(); await dev.waitForTimeout(200);
ctext = await D.confirm.innerText();
ok('device: asks before replacing the prepared answers', /This replaces the 4 prepared answers below\./.test(ctext) && !/Gemini API/.test(ctext), ctext);
await D.confirm.getByRole('button', { name: 'Continue' }).click(); await dev.waitForTimeout(1500);
plog = await D.log(); st = await D.status.innerText();
ok('device: prepared by Gemini Nano, nothing sent', (await D.rows.count()) === 2 && cloud.length === 1 && /2 questions prepared on this computer\. 1 answer was left out/.test(st), st);
ok('log: "On device · preparation · 2 Q&A"', /On device · preparation · 2 Q&A · \d+\.\d s/.test(plog) && /nothing was sent \(ONLY_ON_DEVICE\)/.test(plog), plog.split('\n').slice(0, 2).join(' | '));
// PREFER_IN_CLOUD: the cloud refuses, the SDK falls back to Gemini Nano and the log says so
cloudAnswers = false;
await D.cloudBtn.click(); await D.confirm.getByRole('button', { name: 'Continue' }).click(); await dev.waitForTimeout(2500);
plog = await D.log(); st = await D.status.innerText();
ok('cloud refused: done on device and reported truthfully', /prepared on this computer, because the cloud request failed/.test(st) && /On device · preparation · 2 Q&A/.test(plog.split('\n')[0]) && /The cloud request failed, so Gemini Nano did it on this computer \(PREFER_IN_CLOUD\)/.test(plog), st + ' | ' + plog.split('\n').slice(0, 2).join(' | '));
// a preparation can be stopped
await dev.evaluate(() => (window.__nano.delay = 5000));
await D.deviceBtn.click(); await D.confirm.getByRole('button', { name: 'Continue' }).click(); await dev.waitForTimeout(400);
ok('running: Stop has the focus, buttons are off', await dev.getByRole('button', { name: 'Stop' }).evaluate((b) => b === document.activeElement) && await D.cloudBtn.isDisabled());
await dev.getByRole('button', { name: 'Stop' }).click(); await dev.waitForTimeout(400);
n = await nano();
ok('Stop: the on-device request is aborted, the list is kept', n.prompts.at(-1).aborted && (await D.rows.count()) === 2 && /Stopped/.test(await D.status.innerText()), await D.status.innerText());
ok('Stop: the focus returns to the button that started it', await D.deviceBtn.evaluate((b) => b === document.activeElement));
await dev.evaluate(() => (window.__nano.delay = 300));
await dev.close();
// ---- The README's "For judges" steps, followed to the letter on a computer without Gemini Nano ----
{
  const j = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  j.on('pageerror', e => errs.push('PAGEERROR(judge) ' + e.message));
  await fakeCloud(j, prepReply);
  const jov = () => j.evaluate(() => { const r = document.querySelector('#pipe-up-overlay').shadowRoot; return { cards: [...r.querySelectorAll('.card')].map(c => c.textContent), sel: [...r.querySelectorAll('.card')].findIndex(c => c.classList.contains('sel')), notice: r.querySelector('.notice').textContent }; });
  const jchat = async () => (await j.locator('#chat').innerText()).split('\n').filter(Boolean);
  await j.goto(URL_); await j.waitForTimeout(1500);
  await j.getByRole('button', { name: "1. Load Sam's sample briefing" }).click(); await j.waitForTimeout(2000);
  await j.getByRole('button', { name: '2. Prepare the answers' }).click();
  await j.getByRole('button', { name: 'Prepare with the cloud' }).click();
  await j.getByRole('button', { name: 'Continue' }).click(); await j.locator('section.prep ol.qa li').first().waitFor({ timeout: 15000 }).catch(() => {});
  ok('judge path: "Prepare with the cloud" and confirm lists the prepared answers', (await j.locator('section.prep ol.qa li').count()) === 4);
  await j.getByRole('button', { name: '3. Start the call' }).click(); await j.waitForTimeout(3000);
  let jo = await jov();
  ok('judge path: "3. Start the call" shows replies; without Gemini Nano the first is the prepared answer', jo.cards.length === 3 && /signed except the penalty clause/.test(jo.cards[0]) && /From your briefing/.test(jo.cards[0]), jo.cards[0]);
  await j.keyboard.press('1'); ok('judge path: "1" selects the first reply', (await jov()).sel === 0);
  await j.keyboard.press('Enter'); await j.waitForTimeout(300);
  ok('judge path: Enter posts it in the call chat', ((await jchat()).at(-1) || '').includes('signed except the penalty clause'), (await jchat()).at(-1));
  await j.getByRole('button', { name: 'Next line' }).click(); await j.waitForTimeout(3000);
  await j.keyboard.press('Alt+1'); await j.waitForTimeout(300);
  ok('judge path: after "Next line", Alt+1 holds the floor', ((await jchat()).at(-1) || '').includes("I'm still speaking"), (await jchat()).at(-1));
  await j.keyboard.press('4'); await j.waitForTimeout(300);
  ok('judge path: "4" says "I answered myself"', ((await jchat()).at(-1) || '').includes('answered out loud') && /Got it/.test((await jov()).notice), (await jchat()).at(-1));
  ok('judge path: "Try with the cloud" is there for generated replies', await j.getByRole('button', { name: 'Try with the cloud', exact: true }).isVisible());
  await j.close();
}
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
// A failed check or an unexpected error makes the script fail (CI, pre-commit).
if (R.some((l) => l.startsWith('FAIL')) || errs.length) process.exitCode = 1;
await browser.close(); srv.close();
