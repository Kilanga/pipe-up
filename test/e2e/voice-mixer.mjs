// End-to-end check, run with: node test/e2e/voice-mixer.mjs  (after `npm run build`).
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
import http from 'node:http'; import { readFileSync } from 'node:fs';
const vm = readFileSync(REPO + 'dist/extension/voice-main.js','utf8');
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'content-type':'text/html'}); s.end('<html><body>x</body></html>'); }).listen(8127);
const b = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
for (const flag of ['off','on']) {
  const ctx = await b.newContext({ permissions:['microphone'] }); const page = await ctx.newPage();
  await page.addInitScript(([vm, flag]) => { document.addEventListener('readystatechange', ()=>{}, {once:true}); window.__flag = flag; eval(vm); }, [vm, flag]);
  await page.goto('http://localhost:8127/');
  const r = await page.evaluate(async (flag) => {
    document.documentElement.dataset.pipeUpVoice = flag;
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
    const t = s.getAudioTracks()[0];
    const ch = new MessageChannel(); window.postMessage({ type: 'pipe-up:port' }, location.origin, [ch.port2]); let sid = 0; const st = (pcm) => new Promise(res => { const id = ++sid; const h = e => { if (e.data?.id === id) { ch.port1.removeEventListener('message', h); res(e.data); } }; ch.port1.addEventListener('message', h); ch.port1.start(); ch.port1.postMessage({ id, pcm, rate: 22050 }); });
    const pcm = new Float32Array(22050).map((_, i) => Math.sin(i/10)*0.8);
    const a = await st(pcm);
    t.enabled = false; const m = await st(pcm); t.enabled = true;
    return { label: t.label, settingsEC: t.getSettings().echoCancellation, status: a, muted: m };
  }, flag);
  console.log(flag, JSON.stringify(r));
  // Voice off: Meet gets the plain microphone and a reply is refused ("reload"). Voice on: accepted, refused while muted.
  const good = flag === 'off' ? r.status.ok === false && r.status.reason === 'reload' : r.status.ok === true && r.muted.ok === false && r.muted.reason === 'muted';
  if (!good) process.exitCode = 1;
  console.log(`${good ? 'OK  ' : 'FAIL'} voice ${flag}: the reply is ${flag === 'off' ? 'refused, Meet has the plain microphone' : 'accepted, and refused while muted'}`);
  await ctx.close();
}
// Muting in Meet must silence the voice at once, and audio that cannot be
// played must be reported without blocking the replies that follow.
{
  const ctx = await b.newContext({ permissions:['microphone'] }); const page = await ctx.newPage();
  await page.addInitScript((vm) => { eval(vm); }, vm);
  await page.goto('http://localhost:8127/');
  const r = await page.evaluate(async () => {
    document.documentElement.dataset.pipeUpVoice = 'on';
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const t = s.getAudioTracks()[0];
    // What the call receives: the level of the track handed to Meet.
    const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 2048;
    ac.createMediaStreamSource(new MediaStream([t])).connect(an);
    const level = () => { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); return Math.round(1000 * d.reduce((m, v) => Math.max(m, Math.abs(v)), 0)) / 1000; };
    const wait = (ms) => new Promise(res => setTimeout(res, ms));
    window.__seen = []; addEventListener('message', (e) => window.__seen.push(e.data?.type));
    const ch = new MessageChannel(); window.postMessage({ type: 'pipe-up:port' }, location.origin, [ch.port2]); let sid = 0; const st = (pcm, rate = 22050) => new Promise(res => { const id = ++sid; const h = e => { if (e.data?.id === id) { ch.port1.removeEventListener('message', h); res(e.data); } }; ch.port1.addEventListener('message', h); ch.port1.start(); ch.port1.postMessage({ id, pcm, rate }); });
    const tone = (seconds) => new Float32Array(22050 * seconds).map((_, i) => Math.sin(i/10)*0.5);
    const out = {};
    out.accepted = await st(tone(3));
    await wait(700); out.speaking = level();
    t.enabled = false; await wait(300); out.mutedWhileSpeaking = level();
    t.enabled = true; await wait(300); out.unmuted = level();
    await wait(2200);
    out.empty = await st(new Float32Array(0));
    out.notAudio = await st('not audio');
    out.badRate = await st(tone(1), 0);
    out.next = await st(tone(1));
    await wait(500); out.nextLevel = level();
    await wait(1200); out.quiet = level();
    // The old way in, a window message any script of the page could send: no longer played.
    window.postMessage({ type: 'pipe-up:pcm', pcm: tone(1), rate: 22050 }, location.origin);
    await wait(500); out.afterWindowMessage = level();
    out.seen = [...new Set(window.__seen)];
    return out;
  });
  const ok = (n, c, x = '') => { if (!c) process.exitCode = 1; console.log(`${c ? 'OK  ' : 'FAIL'} ${n} ${x}`); };
  ok('voice reaches the call', r.accepted.ok && r.speaking > 0.1, 'level ' + r.speaking);
  ok('muting in Meet silences the voice during a reply', r.mutedWhileSpeaking < 0.005, 'level ' + r.mutedWhileSpeaking);
  ok('unmuting brings the voice back', r.unmuted > 0.1, 'level ' + r.unmuted);
  ok('empty audio is refused', r.empty.ok === false && r.empty.reason === 'bad-audio', JSON.stringify(r.empty));
  ok('invalid audio is refused', r.notAudio.ok === false && r.badRate.ok === false, JSON.stringify([r.notAudio, r.badRate]));
  ok('the next reply is still played', r.next.ok === true && r.nextLevel > 0.1, 'level ' + r.nextLevel);
  ok('the page never sees the private channel being handed over', !r.seen.includes('pipe-up:port'), JSON.stringify(r.seen));
  ok('a window message is not played any more', r.afterWindowMessage < 0.1 && r.afterWindowMessage <= r.quiet + 0.05, `level ${r.quiet} then ${r.afterWindowMessage}`);
  await ctx.close();
}
await b.close(); srv.close();
