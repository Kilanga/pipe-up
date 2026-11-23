// End-to-end checks of the interface and its accessibility, run with:
// node test/e2e/interface.mjs  (after `npm run build`).
// Real key presses, computed styles and contrast, small screens; the hosted
// demo with a stand-in for Gemini Nano, then the extension's side panel.
// Needs Playwright and Google Chrome; set PLAYWRIGHT and CHROME to override the paths.
import { fileURLToPath } from 'node:url';
import http from 'node:http'; import { readFileSync, existsSync, mkdtempSync } from 'node:fs'; import path from 'node:path'; import { tmpdir } from 'node:os';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const { fakeNano } = await import('./fake-nano.mjs');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = Number(process.env.PORT) || 8140;
const root = REPO + 'dist/demo';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html'; if (!existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(readFileSync(f)); }).listen(PORT);
const URL_ = `http://localhost:${PORT}/`;
const errs = []; const R = []; const ok = (n, c, x = '') => R.push(`${c ? 'OK  ' : 'FAIL'} ${n} ${x}`);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// WCAG contrast of an element's text (or of its border) against the first
// background that is not transparent behind it. Runs in the page.
const contrastOf = ([el, prop]) => {
  const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let bg = [255, 255, 255];
  for (let n = prop === 'color' ? el : el.parentElement; n; n = n.parentElement || n.getRootNode().host) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || c[3] > 0) { bg = c; break; } }
  const a = lum(rgb(getComputedStyle(el)[prop])); const b = lum(bg);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
};

// ---------------- The hosted demo ----------------
async function demo(viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message)); page.on('console', (m) => m.type() === 'error' && !/report-only Content Security Policy/.test(m.text()) && errs.push('console ' + m.text().slice(0, 200)));
  await page.addInitScript(fakeNano);
  await page.goto(URL_); await page.waitForTimeout(2500);
  // The call panel, read through its (open, in the demo) shadow root.
  const ov = () => page.evaluate(() => { const r = document.querySelector('#pipe-up-overlay').shadowRoot; const vis = (e) => Boolean(e && e.getClientRects().length); return {
    cards: [...r.querySelectorAll('.card')].map((c) => c.textContent), sel: [...r.querySelectorAll('.card')].findIndex((c) => c.classList.contains('sel')),
    focus: r.activeElement ? r.activeElement.className || r.activeElement.tagName : '', typed: r.querySelector('.typed').value, min: r.querySelector('.pu').classList.contains('min'),
    notice: r.querySelector('.notice').textContent, noticeShown: vis(r.querySelector('.notice')), noticeMounted: !r.querySelector('.notice').hidden,
    keysHint: vis(r.querySelector('.body > .muted')), preview: vis(r.querySelector('.preview')), hints: [...r.querySelectorAll('.preview .hint, .body > .muted')].filter((e) => vis(e) && /Enter to send/.test(e.textContent)).length,
    self: r.querySelector('.self').textContent, text: r.querySelector('.pu').innerText }; });
  const chat = async () => (await page.locator('#chat').innerText()).split('\n').filter(Boolean);
  const next = async () => { await page.click('#next'); await page.waitForTimeout(2400); };
  const focusIn = (selector, index = 0) => page.evaluate(([s, i]) => document.querySelector('#pipe-up-overlay').shadowRoot.querySelectorAll(s)[i].focus(), [selector, index]);
  const style = (selector, props, inPanel = true) => page.evaluate(([s, props, inPanel]) => { const e = (inPanel ? document.querySelector('#pipe-up-overlay').shadowRoot : document).querySelector(s); const cs = getComputedStyle(e); return Object.fromEntries(props.map((p) => [p, cs[p]])); }, [selector, props, inPanel]);
  return { page, ov, chat, next, focusIn, style };
}

{
  const d = await demo({ width: 1400, height: 900 }); const { page } = d;
  ok('demo: the third step is numbered like the first two', (await page.locator('#next').innerText()) === '3. Start the call');
  let o = await d.ov();
  ok('no suggestion shown: the button does not promise key 4', o.self === 'I answered myself', o.self);
  ok('the notice is in the page from the start, empty and not displayed', o.noticeMounted && !o.noticeShown && o.notice === '');
  // Alt+D with no "tell others" line
  await page.locator('body').click({ position: { x: 5, y: 880 } });
  await page.keyboard.press('Alt+d'); await page.waitForTimeout(200); o = await d.ov();
  ok('Alt+D with no line written says so', o.notice === 'No "Tell others" line yet. Write one in Settings.' && o.noticeShown && (await d.chat()).length === 0, o.notice);
  ok('"Don\'t learn from my replies" (it applies to every call)', /Don't learn from my replies/.test(o.text) && !/this call/.test(o.text));

  // ---- Enter and Tab are shortcuts only on neutral focus or on the selected reply ----
  await d.next(); o = await d.ov();
  ok('three suggestions, key 4 offered now', o.cards.length === 3 && o.self === '4 — I answered myself', o.self);
  ok('no "General reply" tag', !/General reply/.test(o.text));
  ok('one key hint while nothing is selected', o.keysHint && o.hints === 1, String(o.hints));
  await page.keyboard.press('1'); o = await d.ov();
  ok('a reply is selected: its preview carries the only key hint', o.sel === 0 && !o.keysHint && o.preview && o.hints === 1, `hints ${o.hints}`);
  const picked = o.cards[0].replace(/^1/, '');
  // Enter on a quick phrase sends the phrase, not the selected suggestion
  await d.focusIn('.chip'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  let c = await d.chat(); o = await d.ov();
  ok('Enter on "I\'m still speaking" sends that phrase, not the selected reply', c.length === 1 && c[0].includes("I'm still speaking") && o.sel === 0 && o.cards.length === 3, c.join(' | '));
  // Enter on Minimize minimizes, and sends nothing
  await d.focusIn('.icon'); await page.keyboard.press('Enter'); await page.waitForTimeout(200); o = await d.ov();
  ok('Enter on Minimize minimizes and sends nothing', o.min && (await d.chat()).length === 1 && o.cards.length === 3);
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  // Enter on another reply selects it
  await d.focusIn('.card', 1); await page.keyboard.press('Enter'); await page.waitForTimeout(200); o = await d.ov();
  ok('Enter on another reply selects that one and sends nothing', o.sel === 1 && !o.min && (await d.chat()).length === 1, 'sel=' + o.sel);
  // Tab from the selected reply edits; Tab again moves on and reaches "I answered myself"
  await page.keyboard.press('1'); await page.keyboard.press('Tab'); o = await d.ov();
  ok('Tab on the selected reply opens it for editing; the preview gives way to the field', o.focus === 'typed' && o.typed === picked && !o.preview, `${o.focus} ${o.typed}`);
  const path_ = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); path_.push((await d.ov()).focus); if (path_.at(-1) === 'self') break; }
  ok('Tab goes forward from the field through the quick phrases to "I answered myself", without looping', path_.at(-1) === 'self' && !path_.includes('typed') && path_.length === 4, path_.join(' > '));
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); o = await d.ov();
  ok('Shift+Tab goes back to the field, the text is still there', o.focus === 'typed' && o.typed === picked);
  await page.keyboard.press('Escape'); o = await d.ov();
  ok('Esc in the field: the preview of the selected reply comes back', o.typed === '' && o.sel === 0 && o.preview);
  await page.keyboard.press('1'); await page.keyboard.press('Enter'); await page.waitForTimeout(300); c = await d.chat();
  ok('Enter on the selected reply sends it', c.length === 2 && c[1].includes(picked.slice(0, 20)), c.at(-1));

  // ---- Names and shortcuts for assistive technology ----
  await d.next();
  const aria = await page.evaluate(() => { const r = document.querySelector('#pipe-up-overlay').shadowRoot; return { cards: [...r.querySelectorAll('.card')].map((c) => c.getAttribute('aria-keyshortcuts')), chips: [...r.querySelectorAll('.chip')].map((c) => c.getAttribute('aria-keyshortcuts')), self: r.querySelector('.self').getAttribute('aria-keyshortcuts'), role: r.querySelector('.notice').getAttribute('role') }; });
  ok('keys are announced: aria-keyshortcuts on replies, quick phrases and "I answered myself"', aria.cards.join() === '1,2,3' && aria.chips.join() === 'Alt+1,Alt+2,Alt+3' && aria.self === '4' && aria.role === 'status', JSON.stringify(aria));
  const snap = await page.locator('#pipe-up-overlay').ariaSnapshot().catch((e) => 'no snapshot: ' + e.message);
  ok('accessible names: each reply is a button named by its text', /button "?Nano heard/.test(snap) && /button "?I'm still speaking/.test(snap), snap.split('\n').filter((l) => /button/.test(l)).slice(0, 3).join(' | '));
  const sizes = await page.evaluate(() => { const r = document.querySelector('#pipe-up-overlay').shadowRoot; const b = r.querySelector('.icon').getBoundingClientRect(); return { w: b.width, h: b.height }; });
  ok('Minimize is at least 24 by 24 pixels', sizes.w >= 24 && sizes.h >= 24, `${sizes.w}x${sizes.h}`);

  // ---- "From your briefing" tag, plurals, briefing intro ----
  await page.click('#sample'); await page.waitForTimeout(2500);
  await page.click('#prep'); await page.getByRole('button', { name: 'Prepare on this computer' }).click(); await page.waitForTimeout(1500);
  const info = await page.locator('#pu-pane-Briefing [role=status]').first().innerText();
  ok('real plurals in the briefing status', info === 'Active briefing: 3 positions, 1 excerpt, 2 prepared answers.', info);
  ok('briefing intro in plain words', (await page.locator('#pu-pane-Briefing').innerText()).includes('Your notes for this call. Pipe Up builds its replies from them. Check each reply before you send it. They stay on this computer unless you choose otherwise.'));
  await d.next(); await d.next(); o = await d.ov(); // "Do we still think the March deadline is realistic?"
  ok('the prepared answer is tagged "From your briefing"', /From your briefing/.test(o.cards[0]), o.cards[0]);
  const tag = await d.style('.tag', ['fontSize']);
  ok('the tag is at least 12 px', parseFloat(tag.fontSize) >= 12, tag.fontSize);

  // ---- Settings: wording, text size at once, easy reading spacing ----
  await page.click('#pu-tab-Settings');
  const st = await page.locator('#pu-pane-Settings').innerText();
  ok('"Hear the suggestions" reads as a reading aid', st.includes('Hear the suggestions: a reading aid, like a screen reader, in your own headphones.'));
  ok('"Tell others": the example is in the help text, not in a clipped placeholder', st.includes('Optional. Your words, your choice. Example: "I stutter. Sometimes I answer in the chat."') && !(await page.locator('label.field', { hasText: 'Tell others' }).locator('input').getAttribute('placeholder')));
  await page.locator('label.field', { hasText: 'Text size' }).locator('select').selectOption('1.3'); await page.waitForTimeout(300);
  ok('"Text size" applies at once, without "Save settings"', (await page.evaluate(() => document.querySelector('#pipe-up-overlay').shadowRoot.querySelector('.pu').style.getPropertyValue('--scale'))) === '1.3');
  await page.locator('label.check', { hasText: 'Easy reading' }).locator('input').check(); await page.waitForTimeout(400);
  await page.locator('body').click({ position: { x: 5, y: 880 } });
  const spacing = {};
  for (const s of ['.card', '.chip', '.typed', 'select', '.self', '.icon']) spacing[s] = await d.style(s, ['letterSpacing', 'wordSpacing']);
  const base = await d.style('.pu', ['letterSpacing', 'wordSpacing', 'fontSize']);
  ok('easy reading, call panel: replies, quick phrases, field, list and buttons are spaced', parseFloat(base.letterSpacing) > 0 && Object.values(spacing).every((v) => parseFloat(v.letterSpacing) > 0 && parseFloat(v.wordSpacing) > 0), JSON.stringify(Object.fromEntries(Object.entries(spacing).map(([k, v]) => [k, v.letterSpacing]))));
  const side = {};
  for (const s of ['#pu-tab-Live', '#pu-pane-Settings button.primary', '#pu-pane-Settings input[type=text]', '#pu-pane-Settings select', '#pu-pane-Briefing textarea']) side[s] = await d.style(s, ['letterSpacing', 'wordSpacing'], false);
  ok('easy reading, side panel: tabs, buttons, fields and lists are spaced', Object.values(side).every((v) => parseFloat(v.letterSpacing) > 0 && parseFloat(v.wordSpacing) > 0), JSON.stringify(Object.fromEntries(Object.entries(side).map(([k, v]) => [k, v.letterSpacing]))));
  // easy reading + extra large: a reply being edited is shown whole
  await page.keyboard.press('1'); await page.keyboard.press('Tab');
  await page.keyboard.type(' and I will send the full written summary to everyone right after this call'); await page.waitForTimeout(200);
  const fit = await page.evaluate(() => { const t = document.querySelector('#pipe-up-overlay').shadowRoot.querySelector('.typed'); return { scroll: t.scrollHeight, client: t.clientHeight, rows: Math.round(t.clientHeight / parseFloat(getComputedStyle(t).lineHeight)) }; });
  ok('easy reading + extra large: the edit field grows, the reply is not clipped', fit.scroll <= fit.client + 1 && fit.rows >= 2, JSON.stringify(fit));
  await page.keyboard.press('Escape');

  // ---- Light theme: field borders; Live tab: routing log, wording, simulation ----
  const border = await page.locator('#pu-pane-Settings input[type=text]').first().evaluate((el, fn) => new Function('a', `return (${fn})(a)`)([el, 'borderTopColor']), contrastOf.toString());
  ok('field borders reach 3:1 against the page (light theme)', border >= 3, String(border));
  await page.click('#pu-tab-Live');
  const live = await page.locator('#pu-pane-Live').innerText();
  ok('Live tab wording', live.includes('What Pipe Up has learned (Memory tab) is never sent.') && live.includes('For each request: on this computer or in the cloud, and why.') && !/your device|Your history/.test(live));
  ok('demo: the routing log is open', await page.locator('details.routes').evaluate((e) => e.open) && await page.locator('.log li').first().isVisible());
  ok('Gemini Nano ready: the status line says so', /Gemini Nano is ready on this computer\. Suggestions stay on this computer\./.test(live));
  await page.locator('label.check', { hasText: 'simulate a computer without Gemini Nano' }).locator('input').check(); await page.waitForTimeout(500);
  const sim = await page.locator('#pu-pane-Live .status').innerText();
  ok('simulation on: the status line says it is a simulation', /^Demo: you are simulating a computer without Gemini Nano\./.test(sim), sim);
  await page.locator('label.check', { hasText: 'simulate a computer without Gemini Nano' }).locator('input').uncheck(); await page.waitForTimeout(500);
  ok('simulation off: back to the real status', /Gemini Nano is ready/.test(await page.locator('#pu-pane-Live .status').innerText()));
  // Memory: each "Delete" says what it deletes
  await page.click('#pu-tab-Memory'); await page.waitForTimeout(300);
  const del = await page.locator('#pu-pane-Memory .events button').first().getAttribute('aria-label');
  ok('Memory: "Delete" buttons have a name with context', /^Delete this entry: .+ · /.test(del || ''), del);
  await page.close();
}

// ---- Small screens: the panel is in view when the call starts; nothing is cut at 360 px ----
for (const viewport of [{ width: 1100, height: 800 }, { width: 390, height: 844 }, { width: 360, height: 740 }]) {
  const d = await demo(viewport); const { page } = d; const name = `${viewport.width}x${viewport.height}`;
  ok(`${name}: the explanations are folded under "About this demo"`, await page.locator('details.about summary').isVisible() && !(await page.locator('details.about').evaluate((e) => e.open)));
  await page.click('#next'); await page.waitForTimeout(3000);
  const box = await page.evaluate(() => { const r = document.querySelector('#pipe-up-overlay').shadowRoot.querySelector('.pu').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), cards: document.querySelector('#pipe-up-overlay').shadowRoot.querySelectorAll('.card').length }; });
  ok(`${name}: after "Start the call" the suggestions are in view`, box.cards === 3 && box.top >= 0 && (box.bottom <= viewport.height || box.top < viewport.height / 3), JSON.stringify(box));
  if (viewport.width === 360) {
    const tiles = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((t) => { const a = t.getBoundingClientRect(); const b = t.lastElementChild.getBoundingClientRect(); return Math.round(Math.min(b.left - a.left, a.right - b.right)); }));
    ok('360 px: tile labels do not touch the edge', tiles.every((m) => m >= 4), tiles.join(','));
    await page.click('#pu-tab-Settings');
    const help = page.locator('label.field', { hasText: 'Tell others' }).locator('.muted');
    const cut = await help.evaluate((e) => ({ over: e.scrollWidth > e.clientWidth + 1, right: Math.round(e.getBoundingClientRect().right), width: innerWidth }));
    ok('360 px: the "Tell others" example is fully visible', !cut.over && cut.right <= cut.width, JSON.stringify(cut));
    // a long prepared question in easy reading: shown whole
    await page.locator('label.check', { hasText: 'Easy reading' }).locator('input').check();
    await page.click('#sample'); await page.waitForTimeout(2500);
    await page.click('#prep'); await page.getByRole('button', { name: 'Add a question' }).click();
    await page.keyboard.type('What is the status of the vendor contract and of its late-delivery penalty clause, and when does legal review it?'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const q = await page.locator('section.prep ol.qa li').last().locator('textarea.q').evaluate((t) => ({ scroll: t.scrollHeight, client: t.clientHeight, value: t.value }));
    ok('360 px, easy reading: a long prepared question is shown whole, on one field that grows', q.scroll <= q.client + 1 && q.client > 40 && !q.value.includes('\n'), JSON.stringify({ scroll: q.scroll, client: q.client }));
  }
  await page.close();
}
await browser.close(); srv.close();

// ---------------- The extension's side panel ----------------
{
  const EXT = REPO + 'dist/extension';
  const ctx = await chromium.launchPersistentContext(mkdtempSync(tmpdir() + '/pipe-up-ui-'), { executablePath: CHROME, headless: true, args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  await ctx.route(/^https?:/, (r) => r.abort());
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const panel = await ctx.newPage(); panel.on('pageerror', (e) => errs.push('panel ' + e.message));
  const url = `chrome-extension://${new URL(sw.url()).host}/sidepanel.html`;
  await panel.goto(url); await panel.waitForTimeout(1500);
  // No Gemini Nano (headless Chrome) and no App Check token: the cloud is not offered
  let live = await panel.locator('#pu-pane-Live').innerText();
  ok('extension, no Gemini Nano, no token: "Try with the cloud instead" is not offered', await panel.getByRole('button', { name: 'Try with the cloud instead' }).isHidden());
  ok('extension, no Gemini Nano, no token: what still works is said', live.includes('Without it, you still have your quick phrases, your own typed replies and three basic replies.'));
  ok('extension: the routing log is folded', !(await panel.locator('details.routes').evaluate((e) => e.open)) && await panel.locator('details.routes summary').isVisible());
  ok('extension: "Computer voice in the call"', /Computer voice in the call/.test(live) && live.includes('write your own line in Settings, under "Tell others" (Alt+D)') && !/Voice into the call/.test(live));
  // High contrast: header, subtitle, routing-log labels
  await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, highContrast: true } }); }); await panel.waitForTimeout(500);
  await panel.evaluate(() => { document.querySelector('details.routes').open = true; for (const r of ['on_device', 'in_cloud', 'fallback', 'blocked', 'failed']) { const li = document.createElement('li'); const s = document.createElement('span'); s.className = 'route ' + r; s.textContent = r; li.append(s); document.querySelector('.log').append(li); } });
  const ratios = {};
  for (const s of ['.brand strong', '.brand .muted', '.route.on_device', '.route.in_cloud', '.route.fallback', '.route.blocked', '.route.failed', '#pu-tab-Live', '#pu-tab-Memory', '.status', 'details.routes .muted']) ratios[s] = await panel.locator(s).first().evaluate((el, fn) => new Function('a', `return (${fn})(a)`)([el, 'color']), contrastOf.toString());
  ok('high contrast, side panel: header, subtitle, tabs and routing-log labels reach 4.5:1', Object.values(ratios).every((v) => v >= 4.5), JSON.stringify(ratios));
  // the same labels without high contrast, in the light and in the dark theme
  await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, highContrast: false } }); }); await panel.waitForTimeout(400);
  for (const scheme of ['light', 'dark']) {
    await panel.emulateMedia({ colorScheme: scheme });
    const r2 = {};
    for (const s of ['.brand strong', '.brand .muted', '.route.on_device', '.route.in_cloud', '.route.fallback']) r2[s] = await panel.locator(s).first().evaluate((el, fn) => new Function('a', `return (${fn})(a)`)([el, 'color']), contrastOf.toString());
    ok(`${scheme} theme, side panel: header and routing-log labels reach 4.5:1`, Object.values(r2).every((v) => v >= 4.5), JSON.stringify(r2));
  }
  // With a token the cloud can be tried: the button is offered again
  await panel.evaluate(() => { localStorage.setItem('pu-appcheck-debug-token', '00000000-0000-4000-8000-000000000000'); location.reload(); }); await panel.waitForTimeout(2500);
  live = await panel.locator('#pu-pane-Live').innerText();
  ok('extension, token entered: the cloud is offered, the note is gone', await panel.getByRole('button', { name: 'Try with the cloud instead' }).isVisible() && !live.includes('Without it, you still have'));
  await ctx.close();
}
console.log(R.join('\n')); console.log('ERRORS:', errs.join('\n') || 'none');
// A failed check or an unexpected error makes the script fail (CI, pre-commit).
if (R.some((l) => l.startsWith('FAIL')) || errs.length) process.exitCode = 1;
