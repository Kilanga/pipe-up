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
    const st = (pcm) => new Promise(res => { const h = e => { if (e.data?.type==='pipe-up:pcm-status') { removeEventListener('message', h); res(e.data); } }; addEventListener('message', h); window.postMessage({ type:'pipe-up:pcm', pcm, rate:22050 }, location.origin); });
    const pcm = new Float32Array(22050).map((_, i) => Math.sin(i/10)*0.8);
    const a = await st(pcm);
    t.enabled = false; const m = await st(pcm); t.enabled = true;
    return { label: t.label, settingsEC: t.getSettings().echoCancellation, status: a, muted: m };
  }, flag);
  console.log(flag, JSON.stringify(r)); await ctx.close();
}
await b.close(); srv.close();
