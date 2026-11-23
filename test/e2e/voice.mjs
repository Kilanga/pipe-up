// End-to-end check of the local voice, run with: node test/e2e/voice.mjs  (after `npm run build`).
// It loads the built extension, downloads real Piper voices from Hugging Face
// (64 MB each: needs the network), and measures the audio that reaches the call.
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
// VOICES_DIR=/folder/ uses voice files already on disk instead of the network.
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const { VOICES, VOICE_REVISION } = await import(REPO + 'extension/src/voices.js');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const LOCAL = process.env.VOICES_DIR || '';
const EXT = REPO + 'dist/extension';
const [FEMALE, , MALE] = VOICES;
const ctx = await chromium.launchPersistentContext(mkdtempSync(tmpdir() + '/pipe-up-voice-'), {
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
// A stand-in for Meet: chat, captions, a microphone in use, and a probe that
// measures every piece of audio Pipe Up sends to the call.
const MEET_HTML = `<!doctype html><html><body>
<button aria-pressed="false" aria-label="Chat with everyone" id="tog" onclick="this.setAttribute('aria-pressed','true');document.getElementById('chatp').hidden=false">Chat</button>
<div id="chatp" hidden><ol id="msgs"></ol><div><textarea aria-label="Send a message" id="box"></textarea>
<button aria-label="Send a message" onclick="const b=document.getElementById('box'); if(b.value.trim()){const li=document.createElement('li'); li.textContent=b.value; document.getElementById('msgs').append(li); b.value='';}">➤</button></div></div>
<div role="region" aria-label="Captions" id="cap"></div>
<script>
window.say=(who,t)=>{const d=document.createElement('div');d.innerText=who+'\\n'+t;document.getElementById('cap').append(d);};
window.heard=[]; window.statuses=[];
const db=(v)=>Math.round(200*Math.log10(v||1e-9))/10;
// Median pitch of the voiced parts (autocorrelation, 60 to 400 Hz).
function pitch(x,rate){const win=Math.round(0.04*rate),out=[];let peak=0;for(const v of x)peak=Math.max(peak,Math.abs(v));
  for(let s=0;s+win<x.length;s+=win){let e=0;for(let i=0;i<win;i++)e+=x[s+i]*x[s+i];if(Math.sqrt(e/win)<peak*0.08)continue;let best=0,lag=0;
    for(let L=Math.round(rate/400);L<=Math.round(rate/60);L++){let c=0,a=0,b=0;for(let i=0;i+L<win;i++){c+=x[s+i]*x[s+i+L];a+=x[s+i]*x[s+i];b+=x[s+i+L]*x[s+i+L];}const r=c/Math.sqrt(a*b||1);if(r>best){best=r;lag=L;}}
    if(best>0.6)out.push(rate/lag);}
  out.sort((a,b)=>a-b);return out.length?Math.round(out[out.length>>1]):0;}
addEventListener('message',(e)=>{
  if(e.data?.type==='pipe-up:pcm-status') statuses.push(e.data);
  if(e.data?.type!=='pipe-up:pcm') return;
  const p=e.data.pcm, rate=e.data.rate; let peak=0, sum=0, first=-1, last=-1;
  for(let i=0;i<p.length;i++){const a=Math.abs(p[i]); if(a>peak) peak=a; sum+=a*a; if(a>0.01){ if(first<0) first=i; last=i; }}
  heard.push({ at: performance.now(), ms: Math.round(1000*p.length/rate), rate, peakDb: db(peak), rmsDb: db(Math.sqrt(sum/p.length)), leadMs: Math.round(1000*first/rate), tailMs: Math.round(1000*(p.length-1-last)/rate), pitchHz: pitch(p,rate) });
});
navigator.mediaDevices.getUserMedia({audio:true}).then((s)=>(window.mic=s));
</script></body></html>`;
await ctx.route('https://meet.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: MEET_HTML }));

// Voice downloads: counted, taken from disk if asked, and damaged once on request.
const downloads = []; let damageNext = false;
await ctx.route('https://huggingface.co/**', async (route) => {
  const url = route.request().url(); const name = url.split('/').pop();
  downloads.push(url);
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
async function openPanel() {
  panel = await ctx.newPage(); panel.on('pageerror', (e) => errs.push('panel ' + e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`); await panel.waitForTimeout(1500);
}
ctx.on('request', (q) => /^https?:/.test(q.url()) && /\.(m?js|wasm)(\?|$)/.test(q.url()) && remote.push(q.url()));
await openPanel();
const section = () => panel.locator('#pu-pane-Live .field', { has: panel.locator('h2', { hasText: 'Voice into the call' }) }).first();
const status = () => section().locator('p[role=status]').innerText();
const button = (name) => section().getByRole('button', { name });
const waitFor = async (re, seconds = 180) => { for (let i = 0; i < seconds * 2; i++) { if (re.test(await status())) return true; await panel.waitForTimeout(500); } return false; };
const stored = () => panel.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('piper', { create: true }); const n = []; for await (const k of d.keys()) n.push(k); return n.sort(); });
const flag = () => panel.evaluate(async () => (await chrome.storage.local.get('voiceInstalled')).voiceInstalled);

// ---------- Setting up ----------
ok('voice not set up at first', /The voice is not set up/.test(await status()));
const options = await section().locator('select option').allInnerTexts();
ok('three voices with their download size', options.length === 3 && options.every((o) => /\(64 MB\)$/.test(o)), JSON.stringify(options));
ok('the default voice is the first one', (await section().locator('select').inputValue()) === FEMALE.id);

// A download that is not exactly the expected file is refused and nothing is kept.
damageNext = true;
await button(/Set up the voice \(64 MB, once\)/).click();
ok('a damaged download is refused', await waitFor(/Voice setup failed: The voice file is damaged or is not the expected one/, 120), await status());
ok('nothing is stored after a refused download', (await stored()).length === 0, JSON.stringify(await stored()));
ok('Meet is not told a voice exists', !(await flag()));

// "Try again" downloads it properly.
const t0 = Date.now();
await button('Try again').click();
ok('voice downloaded, checked and ready', await waitFor(/The voice is ready/), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
ok('downloaded from the pinned revision of rhasspy/piper-voices', downloads.length > 0 && downloads.every((u) => u.startsWith(`https://huggingface.co/rhasspy/piper-voices/resolve/${VOICE_REVISION}/en/en_US/`)), downloads.at(-1));
ok('model and settings stored', JSON.stringify(await stored()) === JSON.stringify([FEMALE.id + '.onnx', FEMALE.id + '.onnx.json']), JSON.stringify(await stored()));

// ---------- Speaking into the call ----------
const meet = await ctx.newPage(); meet.on('pageerror', (e) => errs.push('meet ' + e.message));
await meet.goto('https://meet.google.com/abc-defg-hij'); await meet.bringToFront(); await meet.waitForTimeout(2500);
ok('voice flag on for new Meet tabs', (await meet.evaluate(() => document.documentElement.dataset.pipeUpVoice)) === 'on');
await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, outputMode: 'voice' } }); });
await meet.waitForTimeout(6000); // time to prepare the quick phrases

// Uses a shortcut and reports what the call received, and how long it took.
async function speak(press) {
  const before = await meet.evaluate(() => heard.length);
  const at = await meet.evaluate(() => performance.now());
  await press();
  for (let i = 0; i < 300; i++) {
    await meet.waitForTimeout(50);
    const h = await meet.evaluate((n) => heard[n], before);
    if (h) return { ...h, waitMs: Math.round(h.at - at), at: undefined };
  }
  return null;
}
const levels = (name, h) => {
  if (!h) return;
  ok(`${name}: peak at -3 dBFS`, h.peakDb <= -2.9 && h.peakDb >= -3.1, `${h.peakDb} dBFS`);
  ok(`${name}: no long silence around the words`, h.leadMs <= 80 && h.tailMs <= 150, `${h.leadMs} ms before, ${h.tailMs} ms after`);
};
const first = await speak(() => meet.keyboard.press('Alt+1'));
ok('Alt+1 is spoken into the call', !!first && first.ms > 800 && first.ms < 4000, JSON.stringify(first));
ok('Alt+1 was ready in advance', !!first && first.waitMs < 200, `${first?.waitMs} ms`);
ok('the call accepted the audio', (await meet.evaluate(() => statuses.at(-1)?.ok)) === true, JSON.stringify(await meet.evaluate(() => statuses.at(-1))));
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

// ---------- Choosing another voice ----------
await section().locator('select').selectOption(MALE.id); await panel.waitForTimeout(500);
ok('another voice is not downloaded without asking', /not on your computer yet/.test(await status()) && (await stored()).length === 2, await status());
const during = await speak(() => meet.keyboard.press('Alt+1'));
ok('the current voice stays in use meanwhile', !!during && during.pitchHz > 165, JSON.stringify(during));
await button(/Download this voice \(64 MB, once\)/).click();
ok('second voice downloaded and ready', await waitFor(/The voice is ready/));
ok('the choice is saved', (await panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings.voice)) === MALE.id);
await meet.waitForTimeout(6000);
const male = await speak(() => meet.keyboard.press('Alt+1'));
ok('male voice: pitch below 150 Hz, ready in advance', !!male && male.pitchHz > 60 && male.pitchHz < 150 && male.waitMs < 200, JSON.stringify(male));
levels('male voice', male);
await meet.waitForTimeout(2500);
// Back to a voice that is already on the computer: no button, no download.
const before = downloads.length;
await section().locator('select').selectOption(FEMALE.id);
ok('a downloaded voice is used at once', (await waitFor(/The voice is ready/, 60)) && downloads.length === before);
await meet.waitForTimeout(6000);
const back = await speak(() => meet.keyboard.press('Alt+1'));
ok('female voice again', !!back && back.pitchHz > 165, JSON.stringify(back));

// ---------- Starting again ----------
// A voice from an older version is removed; the chosen voice starts by itself.
await panel.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('piper'); const w = await (await d.getFileHandle('en_US-hfc_female-medium.onnx', { create: true })).createWritable(); await w.write(new Uint8Array(1000)); await w.close(); });
await panel.close(); await openPanel();
ok('the saved voice starts with the side panel', (await waitFor(/The voice is ready/, 60)) && (await section().locator('select').inputValue()) === FEMALE.id, await status());
ok('files of voices no longer offered are removed', !(await stored()).some((n) => n.includes('hfc_female')), JSON.stringify(await stored()));
// Stored files that changed are refused too.
await panel.evaluate(async (name) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('piper'); const w = await (await d.getFileHandle(name)).createWritable({ keepExistingData: true }); await w.write({ type: 'write', position: 5000, data: new Uint8Array([1, 2, 3]) }); await w.close(); }, FEMALE.id + '.onnx');
await panel.close(); await openPanel();
const usable = await waitFor(/The voice is ready/, 60);
ok('a changed voice file is refused and removed', !(await stored()).includes(FEMALE.id + '.onnx'), JSON.stringify(await stored()));
ok('the other downloaded voice is used instead', usable && (await section().locator('select').inputValue()) === MALE.id, await status());
ok('no code loaded from the network', remote.length === 0, remote.join(' '));
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
await ctx.close();
