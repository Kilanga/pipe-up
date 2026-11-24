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
<div id="qa"><ol id="qamsgs"></ol><div><textarea aria-label="Ask a question" id="qabox"></textarea>
<button aria-label="Send question" onclick="const b=document.getElementById('qabox'); if(b.value.trim()){const li=document.createElement('li'); li.textContent=b.value; document.getElementById('qamsgs').append(li); b.value='';}">ask</button></div></div>
<button aria-pressed="false" aria-label="Raise hand (ctrl + alt + h)" id="hand" data-clicks="0" onclick="const up=this.getAttribute('aria-pressed')!=='true';this.setAttribute('aria-pressed',String(up));this.setAttribute('aria-label',(up?'Lower':'Raise')+' hand (ctrl + alt + h)');this.dataset.clicks=Number(this.dataset.clicks)+1">✋</button>
<div role="region" aria-label="Captions" id="cap"></div>
<script>window.say=(who,t)=>{const d=document.createElement('div');d.innerText=who+'\\n'+t;document.getElementById('cap').append(d);}</script></body></html>`;
await ctx.route('https://meet.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: MEET_HTML }));
// App Check and reCAPTCHA: recorded and stopped here, nothing reaches them.
const checks = [];
await ctx.route(/firebaseappcheck\.googleapis\.com|\/recaptcha\//, (r) => { checks.push(new URL(r.request().url()).host); return r.abort(); });
// In Meet the panel lives in a closed shadow root, which the page cannot open.
// The checks read it the way the extension can: from the content script's
// isolated world (found over CDP), with chrome.dom.openOrClosedShadowRoot.
// What they do to it goes through real keys and clicks (trusted input).
async function isolatedWorld(page) {
  const cdp = await page.context().newCDPSession(page);
  let ctxId = null;
  cdp.on('Runtime.executionContextCreated', ({ context: c }) => { if (c.auxData?.type === 'isolated' && c.origin.startsWith('chrome-extension://')) ctxId = c.id; });
  await cdp.send('Runtime.enable');
  return async (fn) => {
    const expression = `(() => { const root = chrome.dom.openOrClosedShadowRoot(document.getElementById('pipe-up-overlay')); return JSON.stringify((${fn})(root)); })()`;
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, contextId: ctxId, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return JSON.parse(result.value);
  };
}
// Clicks an element of the panel with the real mouse.
async function clickInPanel(page, iso, selector, index = 0) {
  const b = await iso(`(r) => { const x = r.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; }`);
  await page.mouse.click(b.x, b.y);
}
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errs = []; const R = []; const ok = (n, c, x='') => R.push(`${c ? 'OK  ' : 'FAIL'} ${n} ${x}`);
let panel = await ctx.newPage(); panel.on('pageerror', e => errs.push('panel ' + e.message));
await panel.goto(`chrome-extension://${id}/sidepanel.html`); await panel.waitForTimeout(1000);
const meet = await ctx.newPage(); meet.on('pageerror', e => errs.push('meet ' + e.message));
const iso = await isolatedWorld(meet);
await meet.goto('https://meet.google.com/abc-defg-hij'); await meet.bringToFront(); await meet.waitForTimeout(2500);
ok('voice flag on: a voice is included', (await meet.evaluate(() => document.documentElement.dataset.pipeUpVoice)) === 'on');
const ov = () => iso(`(r) => ({ cards: r.querySelectorAll('.card').length, sel: [...r.querySelectorAll('.card')].findIndex((c) => c.classList.contains('sel')), badge: r.querySelector('.badge').textContent, cls: r.querySelector('.pu').className, notice: r.querySelector('.notice')?.textContent, typed: r.querySelector('.typed').value })`);
const qa = () => meet.evaluate(() => [...document.querySelectorAll('#qamsgs li')].map(l => l.textContent));
const msgs = () => meet.evaluate(() => [...document.querySelectorAll('#msgs li')].map(l => l.textContent));
await meet.evaluate(() => say('Maya', 'Can you give us an update on the contract?')); await meet.waitForTimeout(3500);
ok('3 cards from captions', (await ov()).cards === 3);
// ---- A script of the Meet page (another extension, an XSS): the panel's DOM is closed to it, and its synthetic keys and clicks are ignored ----
await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, disclosure: 'I stutter (private line).' } }); }); await meet.waitForTimeout(400);
const pageView = await meet.evaluate(() => { const h = document.getElementById('pipe-up-overlay'); return { root: h.shadowRoot === null, text: h.textContent + h.innerHTML, deep: document.documentElement.innerText.includes('private line') }; });
ok('page script: the panel\'s DOM is closed to it (no suggestions, no "tell others" line)', pageView.root && pageView.text === '' && !pageView.deep, JSON.stringify(pageView));
// synthetic keys, sent the way the audit did: on window, document, body and the panel's host
const fakeKey = (init) => meet.evaluate((init) => { for (const t of [window, document, document.body, document.getElementById('pipe-up-overlay')]) for (const type of ['keydown', 'keypress', 'keyup']) t.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init })); }, init);
await fakeKey({ key: 'd', code: 'KeyD', altKey: true }); await fakeKey({ key: '1', code: 'Digit1', altKey: true }); await meet.waitForTimeout(1200);
ok('page script: synthetic Alt+D and Alt+1 send nothing', (await msgs()).length === 0 && (await qa()).length === 0, JSON.stringify(await msgs()));
await fakeKey({ key: '1', code: 'Digit1' }); await meet.waitForTimeout(300);
ok('page script: synthetic "1" selects nothing', (await ov()).sel === -1, 'sel=' + (await ov()).sel);
await meet.keyboard.press('1'); // the user really selects the first reply…
await fakeKey({ key: 'Enter', code: 'Enter' }); await fakeKey({ key: 'Tab', code: 'Tab' }); await meet.waitForTimeout(1200);
let pv = await ov();
ok('page script: synthetic Enter does not send the reply the user selected, Tab does not edit it', (await msgs()).length === 0 && pv.sel === 0 && pv.typed === '', JSON.stringify([await msgs(), pv.sel, pv.typed]));
await fakeKey({ key: '4', code: 'Digit4' }); await fakeKey({ key: 'Escape', code: 'Escape' }); await meet.waitForTimeout(300);
pv = await ov();
ok('page script: synthetic "4" and Esc dismiss nothing', pv.cards === 3 && pv.sel === 0, JSON.stringify([pv.cards, pv.sel]));
// synthetic clicks: on the host (all the page can reach) and at the place of a card and of a quick phrase
await meet.evaluate(() => { const h = document.getElementById('pipe-up-overlay'); h.click(); h.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); });
const chipAt = await iso(`(r) => { const x = r.querySelector('.chip').getBoundingClientRect(); return { x: x.left + 5, y: x.top + 5 }; }`);
await meet.evaluate(({ x, y }) => { const t = document.elementFromPoint(x, y); for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) t.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, clientX: x, clientY: y })); }, chipAt); await meet.waitForTimeout(1200);
ok('page script: synthetic clicks send nothing', (await msgs()).length === 0 && (await ov()).cards === 3, JSON.stringify(await msgs()));
// the same through real input: Esc unselects, a real click on the second card selects it, Enter sends it
await meet.keyboard.press('Escape'); await clickInPanel(meet, iso, '.card', 1); await meet.waitForTimeout(200);
ok('real click selects a reply', (await ov()).sel === 1, 'sel=' + (await ov()).sel);
// ---- Chat target: the chat is closed and a Q&A panel with a field and a "Send question" button is open ----
await meet.keyboard.press('Enter'); await meet.waitForTimeout(1200);
let m = await msgs(); ok('reply posted in Meet chat', m.length === 1, JSON.stringify(m));
ok('chat target: the chat was opened, nothing went to the other panel', (await qa()).length === 0 && await meet.evaluate(() => !document.getElementById('chatp').hidden), JSON.stringify(await qa()));
// no chat box at all (Meet changed, or the chat is disabled): nothing is typed anywhere, the clipboard notice is shown
await meet.evaluate(() => { document.getElementById('box').setAttribute('aria-label', 'Type here'); });
await meet.keyboard.press('Alt+2'); await meet.waitForTimeout(3200);
ok('chat target: with no chat box, the other panel is not used and the notice says so', (await qa()).length === 0 && (await msgs()).length === 1 && /Could not post in the chat/.test((await ov()).notice), (await ov()).notice);
await meet.evaluate(() => document.getElementById('box').setAttribute('aria-label', 'Send a message'));
await meet.keyboard.press('Alt+d'); await meet.waitForTimeout(1200);
m = await msgs(); ok('real Alt+D sends the "tell others" line', m.at(-1) === 'I stutter (private line).', m.at(-1));
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
// raise hand with "I'm still speaking": off by default, then on (to verify in a real Meet call)
const hand = () => meet.evaluate(() => { const b = document.getElementById('hand'); return { up: b.getAttribute('aria-pressed') === 'true', clicks: Number(b.dataset.clicks) }; });
ok('raise hand: not touched by default', (await hand()).clicks === 0);
await panel.evaluate(() => document.getElementById('pu-tab-Settings').click());
await panel.locator('label.check', { hasText: 'Also raise my hand in Meet' }).locator('input').check(); await meet.waitForTimeout(500);
await meet.evaluate(() => document.body.focus());
await meet.keyboard.press('Alt+1'); await meet.waitForTimeout(1200);
ok('raise hand: raised with "I\'m still speaking"', (await hand()).up && (await hand()).clicks === 1, JSON.stringify(await hand()));
await meet.keyboard.press('Alt+2'); await meet.waitForTimeout(1200);
await meet.keyboard.press('Alt+1'); await meet.waitForTimeout(1200);
ok('raise hand: other phrases do not touch it, and it is never lowered', (await hand()).up && (await hand()).clicks === 1, JSON.stringify(await hand()));
await panel.locator('label.check', { hasText: 'Also raise my hand in Meet' }).locator('input').uncheck(); await meet.waitForTimeout(300);
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
// what the local history holds: key words of the line answered, never the sentence
const idb = await panel.evaluate(() => new Promise((res) => { const q = indexedDB.open('pipe-up'); q.onsuccess = () => { const g = q.result.transaction('events').objectStore('events').getAll(); g.onsuccess = () => res(g.result); }; }));
ok('local history: no caption sentence is stored, only key words', idb.length > 0 && idb.every((e) => !('context' in e) && Array.isArray(e.keys)) && !JSON.stringify(idb).includes('give us an update') && idb.some((e) => e.keys.includes('contract')), JSON.stringify(idb[0]?.keys));
ok('Memory tab says exactly what is kept', /key words of the caption line/.test(mem) && /No audio and no full caption sentence is kept/.test(mem) && /Key words: .*contract/.test(mem) && !/give us an update/.test(mem));
// close the panel, then a question
await panel.close(); await meet.waitForTimeout(800);
await meet.evaluate(() => say('Maya', 'Any blockers?')); await meet.waitForTimeout(3000);
const o = await ov(); ok('panel closed: clear notice, no thinking', !/Thinking/.test(o.badge) && /side panel/i.test(o.notice), o.badge + ' | ' + o.notice);
// reopen the panel: works again
panel = await ctx.newPage(); panel.on('pageerror', e => errs.push('panel2 ' + e.message));
await panel.goto(`chrome-extension://${id}/sidepanel.html`); await meet.bringToFront(); await meet.waitForTimeout(2500);
await meet.evaluate(() => say('Jordan', 'Should we add a vendor?')); await meet.waitForTimeout(3500);
ok('panel reopened: suggestions again', (await ov()).cards === 1);
ok('no debug token: the extension never calls App Check or reCAPTCHA', checks.length === 0, checks.join(', '));
// with a debug token, a token is asked for by a cloud request only, never ahead of time
// (the made-up token is put in the extension page's own storage; the page reloads itself, as in Settings)
await panel.evaluate(() => { localStorage.setItem('pu-appcheck-debug-token', '00000000-0000-4000-8000-000000000000'); location.reload(); }); await panel.waitForTimeout(4000);
ok('debug token set: still no App Check request before a cloud request', checks.length === 0, checks.join(', '));
await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, cloudConsent: true } }); });
await meet.bringToFront(); await meet.waitForTimeout(1500);
await meet.evaluate(() => say('Maya', 'Is the budget approved?')); await meet.waitForTimeout(4500);
const refused = await ov();
ok('debug token + consent: the cloud request asks App Check for a token then, and only then', checks.length >= 1 && checks.every((h) => /firebaseappcheck/.test(h)), checks.join(', '));
ok('cloud not reachable: basic replies and a calm message in the call panel', refused.cards === 1 && /^The cloud could not (answer this time|be reached)\. These are basic replies\. You can still write your own\.$/.test(refused.notice), refused.notice);
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
const iso2 = await isolatedWorld(meet2);
await meet2.goto('https://meet.google.com/abc-defg-hij'); await meet2.bringToFront(); await meet2.waitForTimeout(3000);
const nano = () => panel2.evaluate(() => JSON.parse(JSON.stringify(window.__nano)));
const ov2 = () => iso2(`(r) => ({ cards: [...r.querySelectorAll('.card')].map((c) => c.textContent), badge: r.querySelector('.badge').textContent })`);
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
const plog = await panel2.evaluate(() => { document.getElementById('pu-tab-Live').click(); return document.querySelector('.log').textContent; });
ok('side panel log tells the early start', /started \d+ ms before the pause/.test(plog), plog.split('\n')[0]);
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
// A failed check or an unexpected error makes the script fail (CI, pre-commit).
if (R.some((l) => l.startsWith('FAIL')) || errs.length) process.exitCode = 1;
await ctx2.close();
