// End-to-end check, run with: node test/e2e/autoplay.mjs  (after `npm run build`).
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs'; import path from 'node:path';
const root = REPO + 'dist/demo';
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
const srv = http.createServer((q,s)=>{ let f=path.join(root, decodeURIComponent(q.url.split('?')[0])); if(f.endsWith('/')) f+='index.html'; if(!existsSync(f)){s.writeHead(404);return s.end();} s.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); s.end(readFileSync(f)); }).listen(Number(process.env.PORT) || 8125);
const browser = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox'] });
const page = await browser.newPage();
const errs=[]; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://localhost:${Number(process.env.PORT) || 8125}/`); await page.waitForTimeout(1200);
await page.click('#auto');
const seen = [];
for (let i = 0; i < 12; i++) { await page.waitForTimeout(5000); const c = await page.locator('#captions').innerText(); seen.push(c.split('\n').at(-1).slice(0,40)); }
const lines = [...new Set(seen)];
const button = await page.locator('#auto').innerText();
const R = []; const ok = (n, c, x = '') => R.push(`${c ? 'OK  ' : 'FAIL'} ${n} ${x}`);
ok('auto-play: the five lines of the call are played in order', lines.length === 5 && lines[0].startsWith('Maya') && lines[4].includes('Anything else'), lines.join(' || '));
ok('auto-play: it stops by itself at the end of the script', button === 'Auto-play', button);
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
// A failed check or an unexpected error makes the script fail (CI, pre-commit).
if (R.some((l) => l.startsWith('FAIL')) || errs.length) process.exitCode = 1;
await browser.close(); srv.close();
