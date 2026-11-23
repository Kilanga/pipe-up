// End-to-end check, run with: node test/e2e/demo.mjs  (after `npm run build`).
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
import { tmpdir as _tmp } from 'node:os';
const NOTES = _tmp() + '/pipe-up-notes.txt';
import http from 'node:http'; import { readFileSync, existsSync, writeFileSync } from 'node:fs'; import path from 'node:path';
const root = REPO + 'dist/demo';
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css' };
const srv = http.createServer((q,s)=>{ let f=path.join(root, decodeURIComponent(q.url.split('?')[0])); if(f.endsWith('/')) f+='index.html'; if(!existsSync(f)){s.writeHead(404);return s.end();} s.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); s.end(readFileSync(f)); }).listen(8130);
const browser = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs=[]; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); page.on('console', m => m.type()==='error' && errs.push('console ' + m.text().slice(0,200)));
const R = []; const ok = (name, cond, extra='') => R.push(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`);
const ov = () => page.evaluate(() => { const r = document.querySelector('#pipe-up-overlay')?.shadowRoot; return { cards: [...r.querySelectorAll('.card')].map(c => c.textContent), sel: [...r.querySelectorAll('.card')].findIndex(c => c.classList.contains('sel')), badge: r.querySelector('.badge').textContent, notice: r.querySelector('.notice')?.hidden ? '' : r.querySelector('.notice')?.textContent, typed: r.querySelector('input[type=text]').value, active: r.activeElement?.tagName || null, status: r.querySelector('[role=status]')?.textContent }; });
const chat = async () => (await page.locator('#chat').innerText()).split('\n').filter(Boolean);
const next = async () => { await page.click('#next'); await page.waitForTimeout(3500); };
await page.goto('http://localhost:8130/'); await page.waitForTimeout(1000);
ok('no "null" text', !(await page.locator('#app').innerText()).includes('null'));
await page.click('#sample'); await page.waitForTimeout(1500);
ok('briefing loaded', (await page.locator('#sample').innerText()).includes('Reload'));
await next(); let o = await ov();
ok('3 cards after first line', o.cards.length === 3, JSON.stringify(o.badge));
await page.keyboard.press('2'); o = await ov(); ok('key 2 selects', o.sel === 1, 'active=' + o.active);
await page.keyboard.press('Enter'); await page.waitForTimeout(300);
let c = await chat(); ok('Enter sends reply 2', c.at(-1)?.includes(o.cards[1].replace(/^2/, '').replace(/General reply|From your briefing/, '').trim().slice(0, 15)), c.at(-1));
o = await ov(); ok('cards cleared after send', o.cards.length === 0);
await next(); await page.keyboard.press('1'); await page.keyboard.press('Tab'); o = await ov();
ok('Tab opens edit', o.typed.length > 0 && o.active === 'INPUT', o.typed);
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
const bi = await page.locator('#pu-pane-Briefing [role=status]').innerText(); ok('briefing with document', /excerpt/.test(bi), bi);
// Live tab simulate switch + log
await page.click('#pu-tab-Live'); const log = await page.locator('.log').innerText();
ok('routing log filled', log.length > 10, log.split('\n')[0]);
// reload keeps settings and memory
await page.reload(); await page.waitForTimeout(1500);
await page.click('#pu-tab-Settings');
ok('reduce motion kept after reload', await page.locator('label.check', { hasText: 'Reduce motion' }).locator('input').isChecked());
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
await browser.close(); srv.close();
