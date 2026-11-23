// End-to-end check, run with: node test/e2e/extension.mjs  (after `npm run build`).
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const EXT = REPO + 'dist/extension';
const { fakeNano, fakeCloud, prepReply } = await import('./fake-nano.mjs');
const ctx = await chromium.launchPersistentContext(mkdtempSync(tmpdir() + '/pipe-up-'), {
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const MEET_HTML = `<!doctype html><html><body>
<button aria-pressed="false" aria-label="Chat with everyone" id="tog" onclick="this.setAttribute('aria-pressed','true');document.getElementById('chatp').hidden=false">Chat</button>
<div id="chatp" hidden><ol id="msgs"></ol><div><textarea aria-label="Send a message" id="box"></textarea>
<button aria-label="Send a message" onclick="const b=document.getElementById('box'); if(b.value.trim()){const li=document.createElement('li'); li.textContent=b.value; document.getElementById('msgs').append(li); b.value='';}">➤</button></div></div>
<div role="region" aria-label="Captions" id="cap"></div>
<script>window.say=(who,t)=>{const d=document.createElement('div');d.innerText=who+'\\n'+t;document.getElementById('cap').append(d);}</script></body></html>`;
await ctx.route('https://meet.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: MEET_HTML }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errs = []; const R = []; const ok = (n, c, x='') => R.push(`${c ? 'OK  ' : 'FAIL'} ${n} ${x}`);
let panel = await ctx.newPage(); panel.on('pageerror', e => errs.push('panel ' + e.message));
await panel.goto(`chrome-extension://${id}/sidepanel.html`); await panel.waitForTimeout(1000);
const meet = await ctx.newPage(); meet.on('pageerror', e => errs.push('meet ' + e.message));
await meet.goto('https://meet.google.com/abc-defg-hij'); await meet.bringToFront(); await meet.waitForTimeout(2500);
ok('voice flag off', (await meet.evaluate(() => document.documentElement.dataset.pipeUpVoice)) === 'off');
const ov = () => meet.evaluate(() => { const r = document.getElementById('pipe-up-overlay')?.shadowRoot; return { cards: r.querySelectorAll('.card').length, badge: r.querySelector('.badge').textContent, cls: r.querySelector('.pu').className, notice: r.querySelector('.notice')?.textContent }; });
const msgs = () => meet.evaluate(() => [...document.querySelectorAll('#msgs li')].map(l => l.textContent));
await meet.evaluate(() => say('Maya', 'Can you give us an update on the contract?')); await meet.waitForTimeout(3500);
ok('3 cards from captions', (await ov()).cards === 3);
await meet.keyboard.press('2'); await meet.keyboard.press('Enter'); await meet.waitForTimeout(1200);
let m = await msgs(); ok('reply posted in Meet chat', m.length === 1, JSON.stringify(m));
// own captions must not trigger
await meet.evaluate(() => say('You', 'I think we are fine.')); await meet.waitForTimeout(3000);
ok('own captions do not trigger', (await ov()).cards === 0);
// Alt+1 while the user has a draft in the chat box
await meet.click('#box'); await meet.keyboard.type('my draft');
await meet.keyboard.press('Alt+1'); await meet.waitForTimeout(1200);
m = await msgs(); const draft = await meet.inputValue('#box');
ok('Alt+1 posts filler', m.at(-1)?.includes("still speaking"), m.at(-1));
ok('user draft kept', draft === 'my draft', JSON.stringify(draft));
await meet.fill('#box', '');
// display option from the panel reaches the overlay
await panel.evaluate(() => document.getElementById('pu-tab-Settings').click());
await panel.locator('label.check', { hasText: 'Easy reading' }).locator('input').check(); await meet.waitForTimeout(600);
ok('easy reading reaches the overlay', (await ov()).cls.includes('easy'), (await ov()).cls);
await panel.locator('label.check', { hasText: 'One suggestion at a time' }).locator('input').check(); await meet.waitForTimeout(300);
await meet.evaluate(() => document.body.focus());
await meet.evaluate(() => say('Jordan', 'Is the March deadline realistic?')); await meet.waitForTimeout(3500);
ok('compact: one card', (await ov()).cards === 1);
// memory recorded in the panel
await panel.evaluate(() => document.getElementById('pu-tab-Memory').click()); await panel.waitForTimeout(400);
const mem = await panel.locator('#pu-pane-Memory').innerText(); ok('memory got events', /Picked|Sent|Quick phrase|picked/i.test(mem), mem.split('\n').slice(2,4).join(' / '));
// close the panel, then a question
await panel.close(); await meet.waitForTimeout(800);
await meet.evaluate(() => say('Maya', 'Any blockers?')); await meet.waitForTimeout(3000);
const o = await ov(); ok('panel closed: clear notice, no thinking', !/Thinking/.test(o.badge) && /side panel/i.test(o.notice), o.badge + ' | ' + o.notice);
// reopen the panel: works again
panel = await ctx.newPage(); panel.on('pageerror', e => errs.push('panel2 ' + e.message));
await panel.goto(`chrome-extension://${id}/sidepanel.html`); await meet.bringToFront(); await meet.waitForTimeout(2500);
await meet.evaluate(() => say('Jordan', 'Should we add a vendor?')); await meet.waitForTimeout(3500);
ok('panel reopened: suggestions again', (await ov()).cards === 1);
await ctx.close();

// ---- On-device path in the extension, with a stand-in for Gemini Nano (fake-nano.mjs) ----
const ctx2 = await chromium.launchPersistentContext(mkdtempSync(tmpdir() + '/pipe-up-'), {
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
await ctx2.addInitScript(fakeNano);
await ctx2.route('https://meet.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: MEET_HTML }));
let [sw2] = ctx2.serviceWorkers(); if (!sw2) sw2 = await ctx2.waitForEvent('serviceworker');
const id2 = new URL(sw2.url()).host;
const panel2 = await ctx2.newPage(); panel2.on('pageerror', e => errs.push('panel(dev) ' + e.message)); panel2.on('console', m => m.type() === 'error' && errs.push('panel(dev) console ' + m.text().slice(0, 200)));
await panel2.goto(`chrome-extension://${id2}/sidepanel.html`); await panel2.waitForTimeout(1500);
const meet2 = await ctx2.newPage(); meet2.on('pageerror', e => errs.push('meet(dev) ' + e.message));
await meet2.goto('https://meet.google.com/abc-defg-hij'); await meet2.bringToFront(); await meet2.waitForTimeout(3000);
const nano = () => panel2.evaluate(() => JSON.parse(JSON.stringify(window.__nano)));
const ov2 = () => meet2.evaluate(() => { const r = document.getElementById('pipe-up-overlay')?.shadowRoot; return { cards: [...r.querySelectorAll('.card')].map(c => c.textContent), badge: r.querySelector('.badge').textContent }; });
let n = await nano(); const warm = n.prompts.length;
ok('side panel: warm-up on the fake Gemini Nano', warm === 1 && n.prompts[0].done, String(warm));
await meet2.evaluate(() => say('Maya', 'Do we keep the March deadline?')); await meet2.waitForTimeout(850);
n = await nano(); let o2 = await ov2();
ok('early start: side panel prompts during the silence, nothing shown yet', n.prompts.length === warm + 1 && o2.cards.length === 0, `${n.prompts.length - warm} prompt(s), ${o2.cards.length} card(s)`);
await meet2.waitForTimeout(900); o2 = await ov2(); n = await nano();
ok('early start: shown at the pause, on device', o2.cards.length === 3 && o2.badge === 'On device' && n.prompts.length === warm + 1, o2.badge + ' ' + (o2.cards[0] || ''));
// the speaker goes on during the silence: the early request is cancelled, the full line is answered
await meet2.evaluate(() => say('Jordan', 'One more thing about the budget')); await meet2.waitForTimeout(750);
await meet2.evaluate(() => { document.getElementById('cap').lastElementChild.innerText = 'Jordan\nOne more thing about the budget, is it approved?'; }); await meet2.waitForTimeout(1900);
n = await nano(); o2 = await ov2(); const [cut, full] = n.prompts.slice(warm + 1);
ok('captions changed: early request aborted in the side panel', cut?.aborted && !cut.done, JSON.stringify(cut && { aborted: cut.aborted, done: cut.done }));
ok('captions changed: the full line is answered', full?.done && o2.cards[0]?.includes('budget, is it'), o2.cards[0]);
// ---- Prepare for the call in the side panel ----
const cloudX = await fakeCloud(ctx2, prepReply);
const stored = () => panel2.evaluate(async () => { const s = await chrome.storage.local.get(['briefing', 'settings']); return { prepared: s.briefing?.prepared || [], cloudConsent: Boolean(s.settings?.cloudConsent), share: Boolean(s.settings?.shareBriefingWithCloud) }; });
const rows = panel2.locator('section.prep ol.qa li');
const confirmBox = panel2.locator('section.prep .confirm');
await panel2.evaluate(() => document.getElementById('pu-tab-Briefing').click());
ok('side panel: no "Prepare for the call" before a briefing exists', await panel2.locator('section.prep').isHidden());
await panel2.locator('label.field', { hasText: 'My positions' }).locator('textarea').fill('I want to keep the March deadline if QA can start on February 10.\nI am against a second vendor: it would double the onboarding work.');
await panel2.getByRole('button', { name: 'Save briefing' }).click(); await panel2.waitForTimeout(300);
ok('side panel: "Prepare for the call" appears with the briefing', await panel2.locator('section.prep').isVisible());
await panel2.getByRole('button', { name: 'Prepare on this computer' }).click(); await panel2.waitForTimeout(1200);
let sx = await stored();
ok('side panel: prepared on this computer, stored with the briefing, nothing sent', (await rows.count()) === 2 && sx.prepared.length === 2 && cloudX.length === 0, `${await rows.count()} rows, ${cloudX.length} request(s)`);
await panel2.getByRole('button', { name: 'Prepare with the cloud' }).click(); await panel2.waitForTimeout(200);
const ctext = await confirmBox.innerText();
ok('side panel: the cloud asks first, and says what is sent and replaced', /This sends your briefing text \(about \d+ words\) to the Gemini API through Firebase, once\./.test(ctext) && /This replaces the 2 prepared answers below\./.test(ctext) && cloudX.length === 0, ctext.split('\n')[0]);
await confirmBox.getByRole('button', { name: 'Continue' }).click(); await rows.nth(2).waitFor({ timeout: 15000 }).catch(() => {});
sx = await stored();
ok('side panel: one cloud request, answers stored, standing cloud options still off', cloudX.length === 1 && sx.prepared.length === 4 && !sx.cloudConsent && !sx.share, JSON.stringify([cloudX.length, sx.prepared.length, sx.cloudConsent, sx.share]));
await meet2.evaluate(() => say('Jordan', 'Do we still think the March deadline is realistic?')); await meet2.waitForTimeout(1900);
o2 = await ov2();
ok('call in Meet: the prepared answer is used on device and tagged', o2.badge === 'On device' && o2.cards[0]?.includes('Yes, if QA can start on February 10.') && o2.cards[0]?.includes('From your briefing') && cloudX.length === 1, o2.cards[0]);
await panel2.getByRole('button', { name: 'Delete briefing' }).click(); await panel2.waitForTimeout(300);
ok('side panel: deleting the briefing deletes the prepared answers', (await stored()).prepared.length === 0 && (await rows.count()) === 0);
// on-demand mode never starts early
await panel2.evaluate(() => document.getElementById('pu-tab-Settings').click());
await panel2.locator('label.field', { hasText: 'When to suggest' }).locator('select').selectOption('onDemand');
await panel2.getByRole('button', { name: 'Save settings' }).click(); await meet2.waitForTimeout(500);
const before = (await nano()).prompts.length;
await meet2.evaluate(() => say('Maya', 'Anything else before we close?')); await meet2.waitForTimeout(1800);
ok('on-demand mode: no early start', (await nano()).prompts.length === before, String((await nano()).prompts.length - before));
const plog = await panel2.evaluate(() => { document.getElementById('pu-tab-Live').click(); return document.querySelector('.log').innerText; });
ok('side panel log tells the early start', /started \d+ ms before the pause/.test(plog), plog.split('\n')[0]);
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
await ctx2.close();
