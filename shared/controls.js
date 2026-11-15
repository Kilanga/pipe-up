// Settings, briefing and memory screens. Used by the extension side panel
// and by the hosted demo page.
import { deviceStatus } from '../core/engine.js';
import { buildBriefingIndex } from '../core/briefing.js';
import { adoptionRate } from '../core/memory.js';
import { extractText } from './extract.js';

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== 'string') n[k] = v;
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
};

const STATUS_TEXT = {
  available: 'Gemini Nano is ready on this computer. Suggestions stay on your device.',
  downloadable: 'Gemini Nano can be downloaded (one time, several minutes).',
  downloading: 'Gemini Nano is downloading…',
  unavailable: 'This computer cannot run Gemini Nano (Chrome desktop 139+, about 22 GB free disk space and a GPU with more than 4 GB of VRAM are needed).',
  unsupported: 'This browser has no on-device AI. Use Chrome on desktop and enable chrome://flags/#prompt-api-for-gemini-nano-multimodal-input.',
};
const ROUTE_TEXT = { on_device: 'On device', in_cloud: 'Cloud', fallback: 'Basic replies', blocked: 'Not generated' };
const ACTION_LABEL = { picked: 'Picked a suggestion', edited: 'Edited a suggestion', typed: 'Wrote my own', spoke: 'Answered myself', filler: 'Quick phrase', dismissed: 'Dismissed' };

/**
 * @param {HTMLElement} root
 * @param {object} o
 * @param {() => import('../core/engine.js').SuggestionEngine | null} o.getEngine
 * @param {import('../core/memory.js').MemoryStore} o.memory
 * @param {{get:()=>Promise<object>, set:(patch:object)=>Promise<void>}} o.settings
 * @param {{get:()=>Promise<object>, set:(b:object)=>Promise<void>}} o.briefing
 * @param {(b:object)=>void} o.onBriefing  called with the new briefing index
 * @param {{get:()=>string, set:(v:string)=>void}} [o.debugToken] extension only
 * @param {{status:()=>Promise<string>, setup:(p:(v:number)=>void)=>Promise<void>, test:()=>Promise<void>}} [o.voice] extension only
 * @param {boolean} [o.demo] hosted demo: "simulate no Gemini Nano" switch, no Meet connection
 */
export function mountControls(root, o) {
  const tabs = ['Live', 'Briefing', 'Memory', 'Settings'];
  const panes = {};
  const buttons = {};
  const nav = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Pipe Up sections' });
  let current = 'Live';
  for (const t of tabs) {
    panes[t] = h('section', { class: 'pane', role: 'tabpanel', id: `pu-pane-${t}`, 'aria-labelledby': `pu-tab-${t}`, hidden: t !== current });
    buttons[t] = h(
      'button',
      { role: 'tab', id: `pu-tab-${t}`, 'aria-controls': `pu-pane-${t}`, 'aria-selected': String(t === current), tabindex: t === current ? '0' : '-1', onclick: () => show(t) },
      t
    );
    nav.append(buttons[t]);
  }
  nav.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(current);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    show(tabs[(next + tabs.length) % tabs.length]);
    buttons[current].focus();
  });
  root.replaceChildren(nav, ...Object.values(panes));

  function show(t) {
    current = t;
    for (const k of tabs) {
      buttons[k].setAttribute('aria-selected', String(k === t));
      buttons[k].tabIndex = k === t ? 0 : -1;
      panes[k].hidden = k !== t;
    }
    if (t === 'Memory') renderMemory();
  }

  // ---------- Live ----------
  const connection = h('p', { class: 'connection', role: 'status' }, o.demo ? '' : 'Looking for a Google Meet call in this window…');
  const status = h('p', { class: 'status', role: 'status' }, 'Checking on-device AI…');
  const progress = h('progress', { max: 1, value: 0, hidden: true, 'aria-label': 'Download progress' });
  const setupBtn = h('button', { class: 'primary', onclick: setup, hidden: true }, 'Set up on-device AI');
  const tryCloud = h(
    'button',
    { class: 'primary', hidden: true, onclick: () => o.settings.set({ cloudConsent: true }) },
    'Try with the cloud instead'
  );
  const log = h('ol', { class: 'log', 'aria-label': 'Where each suggestion was generated' });
  const cloud = h('input', { type: 'checkbox', onchange: (e) => o.settings.set({ cloudConsent: e.target.checked }) });
  const shareBriefing = h('input', { type: 'checkbox', onchange: (e) => o.settings.set({ shareBriefingWithCloud: e.target.checked }) });
  const simulate = h('input', {
    type: 'checkbox',
    onchange: (e) => {
      const eng = o.getEngine();
      if (eng) eng.forceCloud = e.target.checked;
    },
  });
  panes.Live.append(
    o.demo ? null : connection,
    h('h2', {}, 'On-device AI'),
    status,
    progress,
    setupBtn,
    tryCloud,
    h('h2', {}, 'Cloud fallback'),
    h(
      'label',
      { class: 'check' },
      cloud,
      h('span', {}, h('b', {}, 'Allow the cloud when on-device AI is not available. '), 'Only the last two caption lines are sent to the Gemini API through Firebase. Your history is never sent.')
    ),
    h(
      'label',
      { class: 'check' },
      shareBriefing,
      h('span', {}, 'Also send relevant briefing excerpts to the cloud. A briefing can contain confidential work information.')
    ),
    o.demo ? h('label', { class: 'check' }, simulate, h('span', {}, 'Demo: simulate a computer without Gemini Nano')) : null,
    o.voice ? voiceSection() : null,
    h('h2', {}, 'Where suggestions were generated'),
    h('p', { class: 'muted' }, 'Read from Firebase AI Logic (inferenceSource) for each request.'),
    log
  );
  const voiceStatus = h('p', { role: 'status' }, 'Checking the voice…');
  const voiceProgress = h('progress', { max: 1, value: 0, hidden: true, 'aria-label': 'Voice download progress' });
  const voiceSetup = h('button', { class: 'primary', hidden: true, onclick: setupVoiceClick }, 'Set up the voice (about 60 MB, once)');
  const voiceTest = h('button', { hidden: true, onclick: () => o.voice.test().catch((e) => (voiceStatus.textContent = 'Voice error: ' + e.message)) }, 'Test the voice');
  function voiceSection() {
    return h(
      'div',
      { class: 'field' },
      h('h2', {}, 'Voice into the call'),
      h('p', { class: 'muted' }, 'Optional. A voice generated on this computer reads your chosen reply to the other participants (choose "Chat + voice" or "Voice only" in the call panel). Your text never leaves your computer.'),
      voiceStatus,
      voiceProgress,
      h('div', { class: 'row' }, voiceSetup, voiceTest)
    );
  }
  async function refreshVoice() {
    if (!o.voice) return;
    const v = await o.voice.status();
    voiceStatus.textContent = { ready: 'The voice is ready.', loading: 'Starting the voice…', missing: 'The voice is not set up.' }[v] || v;
    voiceSetup.hidden = v !== 'missing';
    voiceTest.hidden = v !== 'ready';
  }
  async function setupVoiceClick() {
    voiceSetup.disabled = true;
    voiceProgress.hidden = false;
    try {
      await o.voice.setup((v) => (voiceProgress.value = v));
    } catch (e) {
      voiceStatus.textContent = 'Voice setup failed: ' + (e?.message || e);
    }
    voiceProgress.hidden = true;
    voiceSetup.disabled = false;
    refreshVoice();
  }
  refreshVoice();
  let lastStatus = null;
  let settingsCache = {};

  async function refreshStatus() {
    const s = await deviceStatus();
    lastStatus = s;
    status.textContent = STATUS_TEXT[s] || s;
    setupBtn.hidden = !(s === 'downloadable' || s === 'downloading');
    tryCloud.hidden = s === 'available' || Boolean(settingsCache.cloudConsent);
    return s;
  }
  async function setup() {
    const eng = o.getEngine();
    if (!eng) return;
    setupBtn.disabled = true;
    progress.hidden = false;
    try {
      await eng.prepareDevice((v) => (progress.value = typeof v === 'number' ? v : v?.loaded ?? 0));
    } catch (e) {
      status.textContent = 'Setup failed: ' + (e?.message || e);
    }
    progress.hidden = true;
    setupBtn.disabled = false;
    refreshStatus();
  }
  refreshStatus();

  // ---------- Briefing ----------
  const notes = h('textarea', { rows: 7, placeholder: 'Write or paste your notes: what you want to say, the facts you rely on, an email where you gave your view…' });
  const positions = h('textarea', { rows: 4, placeholder: 'One per line, e.g.\nI want to keep the March deadline.\nI disagree with adding a second vendor.' });
  const docName = h('span', { class: 'muted' }, 'No document');
  const docText = h('textarea', { rows: 6, placeholder: 'Text extracted from your document appears here for review.', 'aria-label': 'Text extracted from your document' });
  const file = h('input', {
    type: 'file',
    accept: '.txt,.md,.pdf,text/plain,text/markdown,application/pdf',
    'aria-label': 'Upload a document',
    onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      docName.textContent = 'Reading ' + f.name + '…';
      try {
        docText.value = await extractText(f);
        docName.textContent = f.name + ' — review the text below, then save.';
      } catch (err) {
        docName.textContent = 'Could not read ' + f.name + ': ' + (err?.message || err);
      }
    },
  });
  const briefInfo = h('p', { class: 'muted', role: 'status' });
  panes.Briefing.append(
    h('p', {}, 'Prepare the call: Pipe Up grounds its suggestions in what you wrote and will not invent facts. Everything stays on this computer.'),
    h('label', { class: 'field' }, h('b', {}, 'My positions'), h('span', { class: 'muted' }, 'Always used first. One per line.'), positions),
    h('label', { class: 'field' }, h('b', {}, 'Write or paste your notes'), notes),
    h('div', { class: 'field' }, h('b', {}, 'Upload a document'), h('span', { class: 'muted' }, '.txt, .md or .pdf, read on this computer'), file, docName, docText),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: saveBriefing }, 'Save briefing'), h('button', { onclick: clearBriefing }, 'Delete briefing')),
    briefInfo
  );
  let briefingDocName = '';
  o.briefing.get().then((b) => {
    notes.value = b?.notes || '';
    positions.value = b?.positions || '';
    docText.value = b?.documentText || '';
    briefingDocName = b?.documentName || '';
    docName.textContent = briefingDocName || 'No document';
    announce(b);
  });
  function announce(b) {
    const idx = buildBriefingIndex(b || {});
    o.onBriefing(idx);
    briefInfo.textContent = idx.chunks.length || idx.positions.length ? `Active briefing: ${idx.positions.length} position(s), ${idx.chunks.length} excerpt(s).` : 'No active briefing.';
  }
  async function saveBriefing() {
    const name = file.files?.[0]?.name || briefingDocName;
    const b = { notes: notes.value, positions: positions.value, documentText: docText.value, documentName: docText.value ? name : '' };
    briefingDocName = b.documentName;
    await o.briefing.set(b);
    announce(b);
  }
  async function clearBriefing() {
    notes.value = positions.value = docText.value = '';
    file.value = '';
    briefingDocName = '';
    docName.textContent = 'No document';
    await o.briefing.set({});
    announce({});
  }

  // ---------- Memory ----------
  const list = h('ul', { class: 'events' });
  const rate = h('p', { class: 'muted' });
  const confirmRow = h(
    'div',
    { class: 'row', hidden: true },
    h('span', {}, 'Delete everything Pipe Up has learned?'),
    h('button', { class: 'primary', onclick: async () => { await o.memory.clear(); confirmRow.hidden = true; renderMemory(); } }, 'Yes, delete'),
    h('button', { onclick: () => (confirmRow.hidden = true) }, 'Cancel')
  );
  panes.Memory.append(
    h('h2', {}, 'What Pipe Up has learned'),
    h('p', { class: 'muted' }, 'Your replies are stored only on this computer and used as examples of your style. Kept 90 days, 500 at most. Nothing you say out loud is recorded.'),
    rate,
    h('button', { onclick: () => (confirmRow.hidden = false) }, 'Delete everything'),
    confirmRow,
    list
  );
  async function renderMemory() {
    const events = (await o.memory.all()).reverse();
    const r = adoptionRate(events);
    rate.textContent = r == null ? 'No data yet.' : `Suggestions used: ${Math.round(r * 100)}% of ${events.filter((e) => e.shown?.length).length} moments.`;
    list.replaceChildren(
      ...events.slice(0, 200).map((e) =>
        h(
          'li',
          {},
          h('div', { class: 'muted' }, `${ACTION_LABEL[e.action] || e.action} · ${new Date(e.ts).toLocaleString()}`),
          e.context ? h('div', {}, '“' + e.context + '”') : null,
          e.reply ? h('div', {}, '→ ', h('b', {}, e.reply)) : null,
          h('button', { class: 'link', onclick: async () => { await o.memory.remove(e.id); renderMemory(); } }, 'Delete')
        )
      )
    );
  }

  // ---------- Settings ----------
  const mode = h('select', {}, h('option', { value: 'auto' }, 'After each pause'), h('option', { value: 'onDemand' }, 'Only when I ask (Alt+S)'));
  const myName = h('input', { type: 'text', placeholder: 'e.g. Sam Taylor', autocomplete: 'off' });
  const fillerInputs = [0, 1, 2].map(() => h('input', { type: 'text' }));
  const disclosure = h('input', { type: 'text', placeholder: 'e.g. I stutter, so I sometimes answer in the chat.' });
  const scale = h('select', {}, ...[['1', 'Normal'], ['1.15', 'Large'], ['1.3', 'Extra large']].map(([v, l]) => h('option', { value: v }, l)));
  const token = h('input', { type: 'password', placeholder: 'App Check debug token (optional)', autocomplete: 'off' });
  const saved = h('span', { class: 'muted', role: 'status' });
  panes.Settings.append(
    h('h2', {}, 'Suggestions'),
    h('label', { class: 'field' }, 'When to suggest replies', mode),
    o.demo ? null : h('label', { class: 'field' }, 'Your name as shown in Meet captions', h('span', { class: 'muted' }, 'Only needed if Meet does not label you "You", so your own words never trigger suggestions.'), myName),
    h('h2', {}, 'Quick phrases'),
    h('p', { class: 'muted' }, 'Sent at once with a click or Alt+1, Alt+2, Alt+3. The first one holds the floor while you speak.'),
    ...fillerInputs.map((inp, i) => h('label', { class: 'field' }, `Phrase ${i + 1}`, inp)),
    h('label', { class: 'field' }, 'Tell others, if you want to (Alt+D)', h('span', { class: 'muted' }, 'Optional and empty by default: your words, your choice.'), disclosure),
    h('label', { class: 'field' }, 'Text size', scale),
    o.debugToken
      ? h(
          'div',
          { class: 'field' },
          h('b', {}, 'Cloud access (developers)'),
          h('p', { class: 'muted' }, 'The cloud fallback needs a Firebase App Check token. It is stored only in this extension and never shared with web pages. On-device suggestions work without it.'),
          token
        )
      : null,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: saveSettings }, 'Save settings'), saved)
  );
  async function saveSettings() {
    await o.settings.set({
      suggestMode: mode.value,
      myName: myName.value.trim(),
      fillers: fillerInputs.map((i) => i.value.trim()).filter(Boolean),
      disclosure: disclosure.value.trim(),
      textScale: Number(scale.value),
    });
    saved.textContent = 'Saved.';
    setTimeout(() => (saved.textContent = ''), 2500);
    if (o.debugToken && token.value.trim() !== o.debugToken.get()) o.debugToken.set(token.value.trim());
  }

  function applySettings(s) {
    settingsCache = s;
    cloud.checked = Boolean(s.cloudConsent);
    shareBriefing.checked = Boolean(s.shareBriefingWithCloud);
    mode.value = s.suggestMode || 'auto';
    myName.value = s.myName || '';
    fillerInputs.forEach((inp, i) => (inp.value = s.fillers?.[i] || ''));
    disclosure.value = s.disclosure || '';
    scale.value = String(s.textScale || 1);
    if (o.debugToken) token.value = o.debugToken.get();
    tryCloud.hidden = lastStatus === 'available' || Boolean(s.cloudConsent);
  }
  o.settings.get().then(applySettings);

  return {
    applySettings,
    refreshStatus,
    refreshVoice,
    setConnection(on) {
      connection.textContent = on ? 'Connected to your Google Meet call.' : 'Open a Google Meet call in this window and turn on captions (reload the Meet tab if Pipe Up was just installed).';
      connection.className = 'connection' + (on ? ' on' : '');
    },
    reportRun(res) {
      const item = h(
        'li',
        {},
        h('span', { class: 'route ' + res.route }, ROUTE_TEXT[res.route] || res.route),
        ` ${res.ms} ms · ${new Date().toLocaleTimeString()}`,
        h('div', { class: 'muted' }, res.reason + (res.hasBriefing ? ' · used your briefing' : ''))
      );
      log.prepend(item);
      while (log.children.length > 10) log.lastChild.remove();
      if (current === 'Memory') renderMemory();
    },
    renderMemory,
  };
}
