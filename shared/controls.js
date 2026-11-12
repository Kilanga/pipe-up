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
  available: 'Gemini Nano is ready on this computer.',
  downloadable: 'Gemini Nano can be downloaded (one time, several minutes).',
  downloading: 'Gemini Nano is downloading…',
  unavailable: 'This computer cannot run Gemini Nano (Chrome desktop 139+, about 22 GB free disk space and a GPU with more than 4 GB of VRAM are needed).',
  unsupported: 'This browser has no on-device AI. Use Chrome on desktop and enable chrome://flags/#prompt-api-for-gemini-nano-multimodal-input.',
};

/**
 * @param {HTMLElement} root
 * @param {object} o
 * @param {() => import('../core/engine.js').SuggestionEngine | null} o.getEngine
 * @param {import('../core/memory.js').MemoryStore} o.memory
 * @param {{get:()=>Promise<object>, set:(patch:object)=>Promise<void>}} o.settings
 * @param {{get:()=>Promise<object>, set:(b:object)=>Promise<void>}} o.briefing
 * @param {(b:object)=>void} o.onBriefing  called with the new briefing index
 * @param {boolean} [o.showDebugToken]
 * @param {boolean} [o.demoSwitch] show "simulate a computer without Gemini Nano"
 */
export function mountControls(root, o) {
  const tabs = ['Live', 'Briefing', 'Memory', 'Settings'];
  const panes = {};
  const nav = h('nav', { class: 'tabs', role: 'tablist' });
  let current = 'Live';
  for (const t of tabs) {
    panes[t] = h('section', { class: 'pane', role: 'tabpanel', 'aria-label': t, hidden: t !== current });
    nav.append(h('button', { role: 'tab', 'aria-selected': String(t === current), onclick: () => show(t) }, t));
  }
  root.replaceChildren(nav, ...Object.values(panes));

  function show(t) {
    current = t;
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === t)));
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== t;
    if (t === 'Memory') renderMemory();
  }

  // ---------- Live ----------
  const status = h('p', { class: 'status' }, 'Checking on-device AI…');
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  const setupBtn = h('button', { class: 'primary', onclick: setup }, 'Set up on-device AI');
  const lastRun = h('p', { class: 'muted' }, 'No suggestions yet.');
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
    h('h2', {}, 'On-device AI'),
    status,
    progress,
    setupBtn,
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
    o.demoSwitch
      ? h('label', { class: 'check' }, simulate, h('span', {}, 'Demo: simulate a computer without Gemini Nano'))
      : null,
    h('h2', {}, 'Last suggestions'),
    lastRun
  );

  async function refreshStatus() {
    const s = await deviceStatus();
    status.textContent = STATUS_TEXT[s] || s;
    setupBtn.hidden = !(s === 'downloadable' || s === 'downloading');
    return s;
  }
  async function setup() {
    const eng = o.getEngine();
    if (!eng) return;
    setupBtn.disabled = true;
    progress.hidden = false;
    try {
      await eng.prepareDevice((v) => (progress.value = v));
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
  const docText = h('textarea', { rows: 6, placeholder: 'Text extracted from your document appears here for review.' });
  const file = h('input', {
    type: 'file',
    accept: '.txt,.md,.pdf,text/plain,text/markdown,application/pdf',
    onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      docName.textContent = 'Reading ' + f.name + '…';
      try {
        docText.value = await extractText(f);
        docName.textContent = f.name;
      } catch (err) {
        docName.textContent = 'Could not read ' + f.name + ': ' + (err?.message || err);
      }
    },
  });
  const briefInfo = h('p', { class: 'muted' });
  panes.Briefing.append(
    h('p', {}, 'Prepare the call: Pipe Up grounds its suggestions in what you wrote and will not invent facts. Everything stays on this computer.'),
    h('label', { class: 'field' }, h('b', {}, 'My positions'), h('span', { class: 'muted' }, ' (always used first)'), positions),
    h('label', { class: 'field' }, h('b', {}, 'Write or paste your notes'), notes),
    h('div', { class: 'field' }, h('b', {}, 'Upload a document'), h('span', { class: 'muted' }, ' .txt, .md or .pdf'), file, docName, docText),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'primary', onclick: saveBriefing }, 'Save briefing'),
      h('button', { onclick: clearBriefing }, 'Delete briefing')
    ),
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
  panes.Memory.append(
    h('h2', {}, 'What Pipe Up has learned'),
    h('p', { class: 'muted' }, 'Your replies are stored only on this computer and used as examples of your style. Kept 90 days, 500 at most.'),
    rate,
    h('button', { onclick: async () => { if (confirm('Delete everything Pipe Up has learned?')) { await o.memory.clear(); renderMemory(); } } }, 'Delete everything'),
    list
  );
  const ACTION_LABEL = { picked: 'Picked a suggestion', typed: 'Typed', spoke: 'Answered myself', filler: 'Quick phrase', dismissed: 'Dismissed' };
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
  const fillerInputs = [0, 1, 2].map(() => h('input', { type: 'text' }));
  const scale = h('select', {}, ...[['1', 'Normal'], ['1.15', 'Large'], ['1.3', 'Extra large']].map(([v, l]) => h('option', { value: v }, l)));
  const token = h('input', { type: 'password', placeholder: 'App Check debug token (optional)', autocomplete: 'off' });
  panes.Settings.append(
    h('h2', {}, 'Quick phrases'),
    h('p', { class: 'muted' }, 'Sent at once with a click or Alt+1, Alt+2, Alt+3.'),
    ...fillerInputs.map((inp, i) => h('label', { class: 'field' }, `Phrase ${i + 1}`, inp)),
    h('label', { class: 'field' }, 'Text size', scale),
    o.showDebugToken
      ? h(
          'div',
          { class: 'field' },
          h('b', {}, 'Cloud access (developers)'),
          h('p', { class: 'muted' }, 'The cloud fallback needs a Firebase App Check token. It is stored only in this browser. On-device suggestions work without it.'),
          token
        )
      : null,
    h('button', { class: 'primary', onclick: saveSettings }, 'Save settings')
  );
  async function saveSettings() {
    await o.settings.set({
      fillers: fillerInputs.map((i) => i.value.trim()).filter(Boolean),
      textScale: Number(scale.value),
      ...(o.showDebugToken ? { appCheckDebugToken: token.value.trim() } : {}),
    });
  }

  function applySettings(s) {
    cloud.checked = Boolean(s.cloudConsent);
    shareBriefing.checked = Boolean(s.shareBriefingWithCloud);
    fillerInputs.forEach((inp, i) => (inp.value = s.fillers?.[i] || ''));
    scale.value = String(s.textScale || 1);
    token.value = s.appCheckDebugToken || '';
  }
  o.settings.get().then(applySettings);

  return {
    applySettings,
    refreshStatus,
    reportRun(res) {
      const where = { on_device: 'on this device', in_cloud: 'in the cloud', fallback: 'basic replies (AI unavailable)', blocked: 'not generated: on-device AI unavailable and cloud not allowed' }[res.route];
      lastRun.textContent = `${res.replies.length} suggestions, ${where}, in ${res.ms} ms${res.hasBriefing ? ', using your briefing' : ''}.`;
      if (current === 'Memory') renderMemory();
    },
    renderMemory,
  };
}
