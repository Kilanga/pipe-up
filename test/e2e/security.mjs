// End-to-end security checks, run with: node test/e2e/security.mjs  (after `npm run build`).
// What a script of the Meet page can and cannot do to Pipe Up: the field where
// a reply is edited, the voice's status channel; and what the side panel
// prints. Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const EXT = REPO + 'dist/extension';
const TOKEN = '11111111-2222-4333-8444-555555555555'; // made up
const ctx = await chromium.launchPersistentContext(mkdtempSync(tmpdir() + '/pipe-up-sec-'), {
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
// A stand-in for Meet: chat, captions, and a microphone in use.
const MEET_HTML = `<!doctype html><html><body>
<button aria-pressed="false" aria-label="Chat with everyone" id="tog" onclick="this.setAttribute('aria-pressed','true');document.getElementById('chatp').hidden=false">Chat</button>
<div id="chatp" hidden><ol id="msgs"></ol><div><textarea aria-label="Send a message" id="box"></textarea>
<button aria-label="Send a message" onclick="const b=document.getElementById('box'); if(b.value.trim()){const li=document.createElement('li'); li.textContent=b.value; document.getElementById('msgs').append(li); b.value='';}">➤</button></div></div>
<div role="region" aria-label="Captions" id="cap"></div>
<script>window.say=(who,t)=>{const d=document.createElement('div');d.innerText=who+'\\n'+t;document.getElementById('cap').append(d);};
window.__seen=[]; addEventListener('message',(e)=>window.__seen.push(String(e.data?.type)+'/'+(e.ports?.length||0)));
navigator.mediaDevices.getUserMedia({audio:true}).then((s)=>(window.mic=s));</script></body></html>`;
// Nothing leaves the machine: only the extension's own files and the stand-in.
await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.protocol === 'chrome-extension:') return r.continue(); if (u.host === 'meet.google.com') return r.fulfill({ status: 200, contentType: 'text/html', body: MEET_HTML }); return r.abort(); });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://meet.google.com' });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errs = []; const R = []; const ok = (n, c, x = '') => R.push(`${c ? 'OK  ' : 'FAIL'} ${n} ${x}`);
const settings = (patch) => panel.evaluate(async (patch) => { const { settings } = await chrome.storage.local.get('settings'); if (patch) await chrome.storage.local.set({ settings: { ...settings, ...patch } }); return { ...settings, ...patch }; }, patch);

// ---- The side panel: the debug token is not printed; a voice setting without a voice is repaired ----
let panel = await ctx.newPage(); const cons = [];
panel.on('pageerror', (e) => errs.push('panel ' + e.message)); panel.on('console', (m) => cons.push(m.text()));
await panel.goto(`chrome-extension://${id}/sidepanel.html`); await panel.waitForTimeout(1500);
// as after an update from 0.3.1: "voice" still chosen, its voice files gone
await panel.evaluate((t) => localStorage.setItem('pu-appcheck-debug-token', t), TOKEN);
await settings({ outputMode: 'chat+voice' });
await panel.reload(); await panel.waitForTimeout(3000);
await panel.evaluate(() => console.log('an ordinary log line'));
await panel.waitForTimeout(200);
ok('debug token: the SDK line that prints it is not shown in the side panel console', !cons.some((c) => c.includes(TOKEN) || /App Check debug token/i.test(c)), cons.filter((c) => /debug token/i.test(c)).join(' | ').replaceAll(TOKEN, '<token>').slice(0, 120));
ok('debug token: console.log is put back, other lines are printed', cons.includes('an ordinary log line'));
ok('update from 0.3.1: no voice on this computer, so "Chat + voice" goes back to "Chat only"', (await settings()).outputMode === 'chat', (await settings()).outputMode);
await panel.evaluate(() => localStorage.removeItem('pu-appcheck-debug-token'));

// ---- The field where a reply is edited ----
const meet = await ctx.newPage(); meet.on('pageerror', (e) => errs.push('meet ' + e.message));
const cdp = await ctx.newCDPSession(meet); let ctxId = null;
cdp.on('Runtime.executionContextCreated', ({ context: c }) => { if (c.auxData?.type === 'isolated' && c.origin.startsWith('chrome-extension://')) ctxId = c.id; });
await cdp.send('Runtime.enable');
// Reads the closed panel the way the extension can: from the content script's world.
const iso = async (fn) => {
  const expression = `(() => { const root = chrome.dom.openOrClosedShadowRoot(document.getElementById('pipe-up-overlay')); return JSON.stringify((${fn})(root)); })()`;
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, contextId: ctxId, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return JSON.parse(result.value);
};
await meet.goto('https://meet.google.com/abc-defg-hij'); await meet.bringToFront(); await meet.waitForTimeout(2500);
const msgs = () => meet.evaluate(() => [...document.querySelectorAll('#msgs li')].map((l) => l.textContent));
const field = () => iso(`(r) => r.querySelector('.typed').value`);
const notice = () => iso(`(r) => r.querySelector('.notice').textContent`);
const pageWrites = (text) => meet.evaluate((text) => [document.execCommand('selectAll'), document.execCommand('insertText', false, text)], text);
await meet.evaluate(() => say('Maya', 'Can you give us an update on the contract?')); await meet.waitForTimeout(3500);
await meet.keyboard.press('1'); await meet.keyboard.press('Tab'); await meet.waitForTimeout(200);
const reply = await field();
ok('a reply is open for editing', reply.length > 5, reply);
await pageWrites('PAGE-WROTE-THIS'); await meet.waitForTimeout(100);
ok('page script: execCommand cannot replace the reply being edited', (await field()) === reply, await field());
await meet.keyboard.press('Enter'); await meet.waitForTimeout(1200);
ok('the real Enter then sends the user\'s reply, not the page\'s text', (await msgs()).at(-1) === reply, JSON.stringify(await msgs()));
// real typing, with an attempt in the middle
const box = await iso(`(r) => { const x = r.querySelector('.typed').getBoundingClientRect(); return { x: x.left + 20, y: x.top + x.height / 2 }; }`);
await meet.mouse.click(box.x, box.y); await meet.keyboard.type('my own words');
await pageWrites('PAGE-WROTE-THIS');
await meet.keyboard.type(' ok'); await meet.keyboard.press('Backspace'); await meet.keyboard.type('k');
ok('real typing and Backspace still work around the attempt', (await field()) === 'my own words ok', await field());
await meet.keyboard.press('Enter'); await meet.waitForTimeout(1200);
ok('typed reply sent as typed', (await msgs()).at(-1) === 'my own words ok', (await msgs()).at(-1));
// paste
await meet.mouse.click(box.x, box.y); await meet.evaluate(() => navigator.clipboard.writeText('pasted text'));
await meet.keyboard.press('Control+V'); await meet.waitForTimeout(150);
ok('paste works', (await field()) === 'pasted text', await field());
// text that does not come from single keys: IME composition, emoji keyboard, autocorrect (CDP makes the same input events)
await cdp.send('Input.imeSetComposition', { text: ' にほ', selectionStart: 3, selectionEnd: 3 });
await cdp.send('Input.imeSetComposition', { text: ' 日本', selectionStart: 3, selectionEnd: 3 });
await cdp.send('Input.insertText', { text: ' 日本' }); await meet.waitForTimeout(150);
ok('IME composition works', (await field()) === 'pasted text 日本', await field());
await cdp.send('Input.insertText', { text: ' 👍' }); await meet.waitForTimeout(150);
ok('text inserted by the system (emoji keyboard, autocorrect) works', (await field()) === 'pasted text 日本 👍', await field());
await meet.keyboard.press('Control+Z'); await meet.waitForTimeout(150);
ok('undo works', (await field()) !== 'pasted text 日本 👍' && (await field()).startsWith('pasted text'), await field());
await meet.keyboard.press('Escape'); await meet.waitForTimeout(100);
ok('Esc empties the field', (await field()) === '');
await pageWrites('PAGE-WROTE-THIS'); // the focus left the field: this goes nowhere in the panel
ok('page script: nothing appears in the emptied field', (await field()) === '');

// ---- The voice: status channel, and a side panel that closes too early ----
// A stand-in side panel (run from the extension's worker) says a voice is ready
// and answers "speak" with half a second of sound, or with nothing (silent).
await panel.close(); await meet.waitForTimeout(500);
await sw.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ voiceInstalled: true, settings: { ...settings, outputMode: 'voice' } }); });
await meet.reload(); await meet.waitForTimeout(2500); // voice-main.js mixes the voice into microphones asked for from now on
await meet.mouse.click(5, 300); // a real click: Chrome lets the page play sound
const standIn = (silent) => sw.evaluate(async (silent) => {
  const [t] = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
  const p = chrome.tabs.connect(t.id, { name: 'pipe-up' }); globalThis.__port = p; globalThis.__got = [];
  p.postMessage({ type: 'voice', ready: true });
  const n = 11025; const b = new Uint8Array(2 * n); for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(i / 8) * 8000); b[2 * i] = v & 255; b[2 * i + 1] = (v >> 8) & 255; }
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  p.onMessage.addListener((m) => { globalThis.__got.push(m.type); if (m.type === 'speak' && !silent) p.postMessage({ type: 'audio', id: m.id, pcm16: btoa(s), rate: 22050 }); });
}, silent);
ok('voice flag on', (await meet.evaluate(() => document.documentElement.dataset.pipeUpVoice)) === 'on');
await standIn(false); await meet.waitForTimeout(300);
const before = (await msgs()).length;
await meet.keyboard.press('Alt+1'); await meet.waitForTimeout(1500);
ok('"voice only", unmuted: spoken, nothing in the chat', (await msgs()).length === before && (await sw.evaluate(() => globalThis.__got)).includes('speak'), JSON.stringify(await msgs()));
// the real status still works: muted in Meet, the reply goes to the chat
await meet.evaluate(() => { window.mic.getAudioTracks()[0].enabled = false; });
await meet.keyboard.press('Alt+2'); await meet.waitForTimeout(1500);
ok('real status (muted in Meet): the reply goes to the chat, and it is said', (await msgs()).length === before + 1 && /repeat/.test((await msgs()).at(-1)) && /You are muted in Meet/.test(await notice()), await notice());
// forged statuses while the voice is being prepared: the old window message, and a port the page makes up
await meet.evaluate(() => { window.mic.getAudioTracks()[0].enabled = true;
  setInterval(() => { for (let id = 0; id < 12; id++) window.postMessage({ type: 'pipe-up:pcm-status', id, ok: false, reason: 'muted' }, location.origin); }, 20);
  const ch = new MessageChannel(); window.postMessage({ type: 'pipe-up:port' }, location.origin, [ch.port2]); for (let id = 0; id < 12; id++) ch.port1.postMessage({ id, ok: false, reason: 'muted' }); });
await standIn(true); await meet.waitForTimeout(300);
await meet.keyboard.press('Alt+3'); await meet.waitForTimeout(1500);
ok('page script: a forged "voice failed" does not send the reply being spoken to the chat', (await msgs()).length === before + 1, JSON.stringify((await msgs()).slice(before)));
const seen = await meet.evaluate(() => [...new Set(window.__seen)]);
ok('page script: the private channel was never visible on window', !seen.includes('pipe-up:port/1'), seen.join(' '));
// the side panel closes between the send and the audio: the reply (Alt+3, still waiting) is not lost
await sw.evaluate(() => globalThis.__port.disconnect()); await meet.waitForTimeout(1500);
ok('"voice only": the side panel closes before the audio comes, the reply goes to the chat', (await msgs()).length === before + 2 && /chat/.test((await msgs()).at(-1)) && /side panel closed before the voice was ready\. Your reply went to the chat/.test(await notice()), `${(await msgs()).at(-1)} | ${await notice()}`);
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
// A failed check or an unexpected error makes the script fail (CI, pre-commit).
if (R.some((l) => l.startsWith('FAIL')) || errs.length) process.exitCode = 1;
await ctx.close();
