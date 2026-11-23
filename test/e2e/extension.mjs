// End-to-end check, run with: node test/e2e/extension.mjs  (after `npm run build`).
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const EXT = REPO + 'dist/extension';
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
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
await ctx.close();
