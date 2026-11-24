// End-to-end check of the local voice, run with: node test/e2e/voice.mjs  (after `npm run build`).
// It loads the built extension and measures the audio that reaches the call:
// first with the included voice and Hugging Face blocked, then with the two
// other voices, really downloaded (64 MB each: needs the network).
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
// VOICES_DIR=/folder/ uses voice files already on disk instead of the network.
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const { VOICES, VOICE_REVISION } = await import(REPO + 'extension/src/voices.js');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const LOCAL = process.env.VOICES_DIR || '';
const EXT = REPO + 'dist/extension';
const [FEMALE, LOWER, MALE] = VOICES;
const MODELS = 'voice/models/';
// A silent microphone (one second of silence, played in a loop by Chrome's
// fake device), so that what is heard on the track Meet uses is the voice.
const SILENCE = tmpdir() + '/pipe-up-silence.wav';
{
  const n = 48000 * 2; const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  writeFileSync(SILENCE, b);
}
// A new browser profile with the extension in folder `ext`.
const launch = (ext) => chromium.launchPersistentContext(mkdtempSync(tmpdir() + '/pipe-up-voice-'), {
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${SILENCE}`, '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await launch(EXT);
// The audio goes from the side panel to the page script over a private
// channel that the Meet page cannot see, so the probe sits in the side panel:
// it measures every piece of audio Pipe Up sends towards the call.
await ctx.addInitScript(() => {
  if (!globalThis.chrome?.tabs?.connect) return; // only the extension's own pages
  const db = (v) => Math.round(200 * Math.log10(v || 1e-9)) / 10;
  // Median pitch of the voiced parts (autocorrelation, 60 to 400 Hz).
  function pitch(x, rate) { const win = Math.round(0.04 * rate), out = []; let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
    for (let s = 0; s + win < x.length; s += win) { let e = 0; for (let i = 0; i < win; i++) e += x[s + i] * x[s + i]; if (Math.sqrt(e / win) < peak * 0.08) continue; let best = 0, lag = 0;
      for (let L = Math.round(rate / 400); L <= Math.round(rate / 60); L++) { let c = 0, a = 0, b = 0; for (let i = 0; i + L < win; i++) { c += x[s + i] * x[s + i + L]; a += x[s + i] * x[s + i]; b += x[s + i + L] * x[s + i + L]; } const r = c / Math.sqrt(a * b || 1); if (r > best) { best = r; lag = L; } }
      if (best > 0.6) out.push(rate / lag); }
    out.sort((a, b) => a - b); return out.length ? Math.round(out[out.length >> 1]) : 0; }
  window.__heard = [];
  function record({ pcm16, rate }) {
    const bin = atob(pcm16); const p = new Float32Array(bin.length / 2);
    for (let i = 0; i < p.length; i++) p[i] = (((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16) >> 16) / 0x7fff;
    let peak = 0; for (const v of p) peak = Math.max(peak, Math.abs(v));
    // Silence is measured as the code trims it (voice-audio.js): 45 dB below the peak.
    const floor = peak * 10 ** (-45 / 20); let first = -1, last = -1;
    for (let i = 0; i < p.length; i++) if (Math.abs(p[i]) >= floor) { if (first < 0) first = i; last = i; }
    window.__heard.push({ at: Date.now(), ms: Math.round((1000 * p.length) / rate), rate, peakDb: db(peak), leadMs: Math.round((1000 * first) / rate), tailMs: Math.round((1000 * (p.length - 1 - last)) / rate), pitchHz: pitch(p, rate) });
  }
  const connect = chrome.tabs.connect.bind(chrome.tabs);
  chrome.tabs.connect = (...args) => { const port = connect(...args); const post = port.postMessage.bind(port); port.postMessage = (m) => { if (m?.type === 'audio') record(m); return post(m); }; return port; };
});
// A stand-in for Meet: chat, captions, and a microphone in use whose level
// (what the call receives) can be read.
const MEET_HTML = `<!doctype html><html><body>
<button aria-pressed="false" aria-label="Chat with everyone" id="tog" onclick="this.setAttribute('aria-pressed','true');document.getElementById('chatp').hidden=false">Chat</button>
<div id="chatp" hidden><ol id="msgs"></ol><div><textarea aria-label="Send a message" id="box"></textarea>
<button aria-label="Send a message" onclick="const b=document.getElementById('box'); if(b.value.trim()){const li=document.createElement('li'); li.textContent=b.value; document.getElementById('msgs').append(li); b.value='';}">➤</button></div></div>
<div role="region" aria-label="Captions" id="cap"></div>
<script>
window.say=(who,t)=>{const d=document.createElement('div');d.innerText=who+'\\n'+t;document.getElementById('cap').append(d);};
navigator.mediaDevices.getUserMedia({audio:true}).then((s)=>{window.mic=s; const ac=new AudioContext(); const an=ac.createAnalyser(); an.fftSize=2048; ac.createMediaStreamSource(new MediaStream([s.getAudioTracks()[0]])).connect(an);
  // Loudest sample on the track handed to Meet, over the next ms.
  window.loudest=async(ms)=>{let m=0; const d=new Float32Array(an.fftSize); const end=performance.now()+ms; while(performance.now()<end){an.getFloatTimeDomainData(d); for(const v of d) m=Math.max(m,Math.abs(v)); await new Promise((r)=>setTimeout(r,30));} return Math.round(1000*m)/1000;};});
</script></body></html>`;
await ctx.route('https://meet.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: MEET_HTML }));

// Voice downloads: blocked at first, then counted, taken from disk if asked, and damaged once on request.
const downloads = []; let damageNext = false; let online = false;
await ctx.route('https://huggingface.co/**', async (route) => {
  const url = route.request().url(); const name = url.split('/').pop();
  downloads.push(url);
  if (!online) return route.abort();
  const local = LOCAL && existsSync(LOCAL + name);
  if (!local && !(damageNext && name.endsWith('.onnx'))) return route.continue();
  let body = Buffer.from(local ? readFileSync(LOCAL + name) : await (await route.fetch()).body());
  if (damageNext && name.endsWith('.onnx')) { body[body.length >> 1] ^= 1; damageNext = false; } // one bit
  await route.fulfill({ status: 200, body, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream' } });
});

let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errs = []; const R = []; const ok = (n, c, x = '') => R.push(`${c ? 'OK  ' : 'FAIL'} ${n} ${x}`);
let panel; const remote = [];
async function openPanel(wait = 1500) {
  panel = await ctx.newPage(); panel.on('pageerror', (e) => errs.push('panel ' + e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`); await panel.waitForTimeout(wait);
}
ctx.on('request', (q) => /^https?:/.test(q.url()) && /\.(m?js|wasm)(\?|$)/.test(q.url()) && remote.push(q.url()));
// What is in the built extension is the voice whose license was checked.
const sha = (name) => createHash('sha256').update(readFileSync(EXT + '/' + MODELS + name)).digest('hex');
ok('the built extension holds the included voice, with the expected SHA-256', sha(FEMALE.id + '.onnx') === FEMALE.sha256 && sha(FEMALE.id + '.onnx.json') === FEMALE.configSha256);
ok('its model card is in the license folder', /License: public domain/.test(readFileSync(EXT + '/voice/licenses/MODEL_CARD-' + FEMALE.id + '.md', 'utf8')));
const opened = Date.now();
await openPanel(0);
const section = () => panel.locator('#pu-pane-Live .field', { has: panel.locator('h2', { hasText: 'Computer voice in the call' }) }).first();
const status = () => section().locator('p[role=status]').innerText();
const button = (name) => section().getByRole('button', { name });
const waitFor = async (re, seconds = 180) => { for (let i = 0; i < seconds * 10; i++) { if (re.test(await status().catch(() => ''))) return true; await panel.waitForTimeout(100); } return false; };
const stored = () => panel.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('piper', { create: true }); const n = []; for await (const k of d.keys()) n.push(k); return n.sort(); });
const flag = () => panel.evaluate(async () => (await chrome.storage.local.get('voiceInstalled')).voiceInstalled);

// ---------- A new install, with Hugging Face blocked ----------
ok('new install: the voice is ready by itself', await waitFor(/The voice is ready/, 60), `${((Date.now() - opened) / 1000).toFixed(1)} s after the side panel was opened`);
const options = await section().locator('select option').allInnerTexts();
ok('one voice included, two with their download size', options.length === 3 && /\(included\)$/.test(options[0]) && options.slice(1).every((o) => /\(64 MB\)$/.test(o)), JSON.stringify(options));
ok('the text says so', /One voice is included\. The two others are optional downloads of about 64 MB each\./.test(await section().innerText()) && /Others hear a computer voice, not yours/.test(await section().innerText()));
ok('the included voice is the one in use', (await section().locator('select').inputValue()) === FEMALE.id);
ok('no button to set up or download', (await section().getByRole('button').allInnerTexts()).join() === 'Test the voice', (await section().getByRole('button').allInnerTexts()).join());
ok('nothing was asked from Hugging Face', downloads.length === 0, downloads.join(' '));
ok('no copy of the voice in the extension\'s storage', (await stored()).length === 0, JSON.stringify(await stored()));
ok('a voice is known to be ready', (await flag()) === true);
ok('the output stays "Chat only" until the user chooses the voice', (await panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings.outputMode)) === 'chat');
await button('Test the voice').click(); await panel.waitForTimeout(2500);
ok('"Test the voice" plays without an error', /The voice is ready/.test(await status()), await status());

// ---------- Speaking into the call ----------
const meet = await ctx.newPage(); meet.on('pageerror', (e) => errs.push('meet ' + e.message));
// The panel in Meet is in a closed shadow root: its notice is read from the
// content script's isolated world (found over CDP), as in extension.mjs.
const cdp = await ctx.newCDPSession(meet); let world = null;
cdp.on('Runtime.executionContextCreated', ({ context: c }) => { if (c.auxData?.type === 'isolated' && c.origin.startsWith('chrome-extension://')) world = c.id; });
await cdp.send('Runtime.enable');
const notice = async () => (await cdp.send('Runtime.evaluate', { contextId: world, returnByValue: true, expression: `chrome.dom.openOrClosedShadowRoot(document.getElementById('pipe-up-overlay')).querySelector('.notice')?.textContent || ''` })).result.value;
const voiceFlag = () => meet.evaluate(() => document.documentElement.dataset.pipeUpVoice);
// What Meet got from getUserMedia: the browser's own track, or Pipe Up's mixed one (which carries its own "enabled", "label"… and "stop").
const track = () => meet.evaluate(() => { const t = mic.getAudioTracks()[0]; return { label: t.label, own: Object.getOwnPropertyNames(t).sort().join(), nativeStop: /\[native code\]/.test(Function.prototype.toString.call(t.stop)) }; });
await meet.goto('https://meet.google.com/abc-defg-hij'); await meet.bringToFront(); await meet.waitForTimeout(2500);
// A new install stays on "Chat only": Meet's microphone is not touched.
const plain = await track();
ok('"Chat only": the voice flag is off although a voice is ready', (await voiceFlag()) === 'off' && (await flag()) === true);
ok('"Chat only": Meet gets the plain microphone track, untouched (no mixer)', /fake/i.test(plain.label) && plain.own === '' && plain.nativeStop, JSON.stringify(plain));
// The voice is chosen during the call: the user is told to reload, and the reply is not lost.
await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, outputMode: 'voice' } }); });
await meet.waitForTimeout(6000); // time to prepare the quick phrases
ok('voice chosen: the flag follows, for microphones asked from now on', (await voiceFlag()) === 'on' && (await track()).own === '');
await meet.keyboard.press('Alt+1'); await meet.waitForTimeout(1500);
ok('voice chosen after joining: "reload this Meet tab", and the reply goes to the chat', /The voice was chosen after you joined: reload this Meet tab to use it\./.test(await notice()) && (await meet.evaluate(() => document.querySelectorAll('#msgs li').length)) === 1, await notice());
await meet.reload(); await meet.bringToFront(); await meet.waitForTimeout(4000);
const mixed = await track();
ok('after the reload: Meet gets the mixed track, with the real microphone\'s label', (await voiceFlag()) === 'on' && mixed.label === plain.label && /enabled/.test(mixed.own) && !mixed.nativeStop, JSON.stringify(mixed));

// Uses a shortcut and reports what the call received, and how long it took.
async function speak(press) {
  const before = await panel.evaluate(() => window.__heard.length);
  const at = Date.now();
  await press();
  for (let i = 0; i < 300; i++) {
    await meet.waitForTimeout(50);
    const h = await panel.evaluate((n) => window.__heard[n], before);
    if (h) return { ...h, waitMs: h.at - at, at: undefined };
  }
  return null;
}
const levels = (name, h) => {
  if (!h) return;
  ok(`${name}: peak at -3 dBFS`, h.peakDb <= -2.9 && h.peakDb >= -3.1, `${h.peakDb} dBFS`);
  ok(`${name}: no long silence around the words`, h.leadMs <= 80 && h.tailMs <= 150, `${h.leadMs} ms before, ${h.tailMs} ms after`);
};
const quiet = await meet.evaluate(() => loudest(400));
const first = await speak(() => meet.keyboard.press('Alt+1'));
const inCall = await meet.evaluate(() => loudest(700));
ok('Alt+1 is spoken into the call', !!first && first.ms > 800 && first.ms < 4000, JSON.stringify(first));
ok('Alt+1 was ready in advance', !!first && first.waitMs < 200, `${first?.waitMs} ms`);
ok('the voice is heard on the microphone track Meet uses', quiet < 0.01 && inCall > 0.1, `level ${quiet} before, ${inCall} while speaking`);
ok('"voice only": nothing posted in the chat', (await meet.evaluate(() => document.querySelectorAll('#msgs li').length)) === 0);
levels('quick phrase', first);
await meet.waitForTimeout(2500);
const again = await speak(() => meet.keyboard.press('Alt+2'));
ok('Alt+2 was ready in advance', !!again && again.waitMs < 200, JSON.stringify(again));
await meet.waitForTimeout(2500);
// Suggestions: the first one is prepared in the background, the others are not.
await meet.evaluate(() => document.body.focus());
await meet.evaluate(() => say('Maya', 'Can you give us an update on the contract?')); await meet.waitForTimeout(5000);
const picked1 = await speak(async () => { await meet.keyboard.press('1'); await meet.keyboard.press('Enter'); });
ok('the first suggestion was ready in advance', !!picked1 && picked1.waitMs < 200, JSON.stringify(picked1));
await meet.waitForTimeout(3000);
await meet.evaluate(() => say('Jordan', 'Is the March deadline realistic?')); await meet.waitForTimeout(5000);
const picked2 = await speak(async () => { await meet.keyboard.press('2'); await meet.keyboard.press('Enter'); });
ok('another suggestion is spoken after a short wait', !!picked2 && picked2.waitMs < 5000, JSON.stringify(picked2));
levels('suggestion', picked2);
ok('female voice: pitch above 165 Hz', first?.pitchHz > 165 && picked2?.pitchHz > 165, `${first?.pitchHz} Hz, ${picked2?.pitchHz} Hz`);
await meet.waitForTimeout(3000);
ok('all of this without Hugging Face', downloads.length === 0, downloads.join(' '));

// ---------- Choosing another voice ----------
online = true;
const pick = async (v) => { await section().locator('select').selectOption(v.id); await panel.waitForTimeout(500); };
await pick(MALE);
ok('another voice is not downloaded without asking', /not on this computer yet/.test(await status()) && downloads.length === 0, await status());
const during = await speak(() => meet.keyboard.press('Alt+1'));
ok('the current voice stays in use meanwhile', !!during && during.pitchHz > 165, JSON.stringify(during));
// A download that is not exactly the expected file is refused and nothing is kept.
damageNext = true;
await button(/Download this voice \(64 MB, once\)/).click();
ok('a damaged download is refused', await waitFor(/Voice setup failed: The voice file is damaged or is not the expected one/, 120), await status());
ok('nothing is stored after a refused download', (await stored()).length === 0, JSON.stringify(await stored()));
ok('the included voice is still the one in use', (await section().locator('select').inputValue()) === FEMALE.id && (await flag()) === true);
await pick(MALE);
const t0 = Date.now();
await button(/Download this voice \(64 MB, once\)/).click();
ok('second voice downloaded, checked and ready', await waitFor(/The voice is ready/), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
ok('downloaded from the pinned revision of rhasspy/piper-voices', downloads.length > 0 && downloads.every((u) => u.startsWith(`https://huggingface.co/rhasspy/piper-voices/resolve/${VOICE_REVISION}/en/en_US/`)), downloads.at(-1));
ok('its model and settings are stored', JSON.stringify(await stored()) === JSON.stringify([MALE.id + '.onnx', MALE.id + '.onnx.json']), JSON.stringify(await stored()));
ok('the choice is saved', (await panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings.voice)) === MALE.id);
await meet.waitForTimeout(6000);
const male = await speak(() => meet.keyboard.press('Alt+1'));
ok('male voice: pitch below 150 Hz, ready in advance', !!male && male.pitchHz > 60 && male.pitchHz < 150 && male.waitMs < 200, JSON.stringify(male));
levels('male voice', male);
await meet.waitForTimeout(2500);
// The third voice downloads and speaks too.
await pick(LOWER);
await button(/Download this voice \(64 MB, once\)/).click();
ok('third voice downloaded, checked and ready', (await waitFor(/The voice is ready/)) && (await stored()).length === 4, JSON.stringify(await stored()));
await meet.waitForTimeout(6000);
const lower = await speak(() => meet.keyboard.press('Alt+1'));
ok('third voice: spoken, ready in advance', !!lower && lower.ms > 800 && lower.waitMs < 200, JSON.stringify(lower));
levels('third voice', lower);
await meet.waitForTimeout(2500);
// Back to voices that are already on the computer: no button, no download.
const before = downloads.length;
await pick(MALE);
ok('a downloaded voice is used at once', (await waitFor(/The voice is ready/, 60)) && downloads.length === before);
await pick(FEMALE);
ok('the included voice is used at once', (await waitFor(/The voice is ready/, 60)) && downloads.length === before && (await panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings.voice)) === FEMALE.id);
await meet.waitForTimeout(6000);
const back = await speak(() => meet.keyboard.press('Alt+1'));
ok('female voice again', !!back && back.pitchHz > 165, JSON.stringify(back));

// ---------- Starting again ----------
// Coming from 0.4.0: the downloaded copy of the voice that is now included is
// removed, and so is a voice from an older version. The chosen voice starts by itself.
const put = (name, bytes) => panel.evaluate(async ([name, bytes]) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('piper'); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(new Uint8Array(bytes)); await w.close(); }, [name, bytes]);
for (const name of [FEMALE.id + '.onnx', FEMALE.id + '.onnx.json', 'en_US-hfc_female-medium.onnx']) await put(name, 1000);
online = false;
const asked = downloads.length;
await panel.close(); await openPanel();
ok('the saved voice starts with the side panel', (await waitFor(/The voice is ready/, 60)) && (await section().locator('select').inputValue()) === FEMALE.id, await status());
ok('the copy downloaded by 0.4.0 is removed, other downloaded voices are kept', JSON.stringify(await stored()) === JSON.stringify([MALE.id, LOWER.id].flatMap((v) => [v + '.onnx', v + '.onnx.json']).sort()), JSON.stringify(await stored()));
// Stored files that changed are refused.
await pick(MALE); await waitFor(/The voice is ready/, 60);
await panel.evaluate(async (name) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('piper'); const w = await (await d.getFileHandle(name)).createWritable({ keepExistingData: true }); await w.write({ type: 'write', position: 5000, data: new Uint8Array([1, 2, 3]) }); await w.close(); }, MALE.id + '.onnx');
await panel.close(); await openPanel();
const usable = await waitFor(/The voice is ready/, 60);
ok('a changed voice file is refused and removed', !(await stored()).includes(MALE.id + '.onnx'), JSON.stringify(await stored()));
ok('the included voice is used instead, without a download', usable && (await section().locator('select').inputValue()) === FEMALE.id && downloads.length === asked, await status());
ok('no code loaded from the network', remote.length === 0, remote.join(' '));
await ctx.close();

// ---------- An extension whose included voice is missing or was changed ----------
// Pipe Up still works, in the chat: it says why, and "voice" does not stay chosen.
for (const [what, spoil] of [['missing', null], ['changed', (bytes) => (bytes[bytes.length >> 1] ^= 1)]]) {
  const ext = mkdtempSync(tmpdir() + '/pipe-up-ext-');
  const model = MODELS + FEMALE.id + '.onnx';
  cpSync(EXT, ext, { recursive: true, filter: (from) => !from.endsWith('.onnx') });
  if (spoil) { const bytes = readFileSync(EXT + '/' + model); spoil(bytes); writeFileSync(ext + '/' + model, bytes); }
  const c = await launch(ext);
  const asked = []; await c.route('https://huggingface.co/**', (r) => { asked.push(r.request().url()); return r.abort(); });
  let [w] = c.serviceWorkers(); if (!w) w = await c.waitForEvent('serviceworker');
  await w.evaluate(() => chrome.storage.local.set({ settings: { outputMode: 'chat+voice' } }));
  panel = await c.newPage(); panel.on('pageerror', (e) => errs.push('panel ' + e.message));
  await panel.goto(`chrome-extension://${new URL(w.url()).host}/sidepanel.html`);
  ok(`included voice ${what}: a clear message`, await waitFor(/The voice could not start\. The included voice is missing or damaged\. Install Pipe Up again, or choose another voice\./, 60), await status());
  await panel.waitForTimeout(500);
  const kept = await panel.evaluate(() => chrome.storage.local.get(['voiceInstalled', 'settings']));
  ok(`included voice ${what}: Meet is not told a voice exists, the output goes back to "Chat only"`, kept.voiceInstalled === false && kept.settings.outputMode === 'chat', JSON.stringify({ flag: kept.voiceInstalled, output: kept.settings.outputMode }));
  ok(`included voice ${what}: nothing is downloaded in its place`, asked.length === 0 && (await section().getByRole('button').allInnerTexts()).join() === 'Try again', asked.join(' '));
  await c.close();
}
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
// A failed check or an unexpected error makes the script fail (CI, pre-commit).
if (R.some((l) => l.startsWith('FAIL')) || errs.length) process.exitCode = 1;
