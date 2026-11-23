// Settings, briefing and memory screens. Used by the extension side panel
// and by the hosted demo page.
import { deviceStatus } from '../core/engine.js';
import { CLOUD_PROBLEM_TEXT } from '../core/config.js';
import { buildBriefingIndex, PREPARED_LIMITS } from '../core/briefing.js';
import { planPreparation, PREP_LIMITS } from '../core/prepare.js';
import { adoptionRate, LIMITS as MEMORY_LIMITS } from '../core/memory.js';
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

// Element.append(null) would insert the text "null": skip empty slots.
const put = (parent, ...kids) => parent.append(...kids.flat().filter((k) => k != null));

const STATUS_TEXT = {
  available: 'Gemini Nano is ready on this computer. Suggestions stay on this computer.',
  // Hosted demo, with the "simulate" box ticked.
  simulated: 'Demo: you are simulating a computer without Gemini Nano. (Gemini Nano is in fact ready on this computer.)',
  downloadable: 'Gemini Nano can be downloaded (one time, several minutes).',
  downloading: 'Gemini Nano is downloading…',
  // Same requirements as the README ("Gemini Nano setup").
  unavailable: 'Gemini Nano is not available on this computer. It needs Chrome 139 or later on desktop, about 22 GB of free disk space, and either a GPU with more than 4 GB of VRAM or a CPU with 16 GB of RAM and 4 cores.',
  unsupported: 'This browser does not offer on-device AI. Use an up-to-date Chrome on desktop. If the model is still not offered, open chrome://flags, enable #prompt-api-for-gemini-nano-multimodal-input and "Gemma 4 for Built-in AI", then restart Chrome.',
};
const ROUTE_TEXT = { on_device: 'On device', in_cloud: 'Cloud', fallback: 'Basic replies', blocked: 'Basic replies', failed: 'Not prepared' };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const ACTION_LABEL = { picked: 'Picked a suggestion', edited: 'Edited a suggestion', typed: 'Wrote my own', spoke: 'Answered myself', filler: 'Quick phrase', dismissed: 'Dismissed' };

/**
 * @param {HTMLElement} root
 * @param {object} o
 * @param {() => import('../core/engine.js').SuggestionEngine | null} o.getEngine
 * @param {import('../core/memory.js').MemoryStore} o.memory
 * @param {{get:()=>Promise<object>, set:(patch:object)=>Promise<void>}} o.settings
 * @param {{get:()=>Promise<object>, set:(b:object, info?:{byUser:boolean})=>Promise<void>}} o.briefing
 * @param {(b:object)=>void} o.onBriefing  called with the new briefing index
 * @param {{get:()=>string, set:(v:string)=>void}} [o.debugToken] extension only
 * @param {{list:{id:string,label:string,mb:number}[], status:()=>Promise<{state:string,voice:string,downloaded:string[]}>, choose:(id:string,p?:(v:number)=>void)=>Promise<void>, test:()=>Promise<void>}} [o.voice] extension only
 * @param {(on:boolean) => void} [o.onSimulate] hosted demo: the "simulate" switch changed
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
  // Extension without an App Check token: the cloud can only refuse, so it
  // is not offered; what still works is said instead.
  const cloudImpossible = () => Boolean(o.debugToken && !o.debugToken.get());
  const noAiNote = h('p', { hidden: true }, 'Without it, you still have your quick phrases, your own typed replies and three basic replies.');
  const showCloudOffer = () => {
    const missing = lastStatus != null && lastStatus !== 'available';
    tryCloud.hidden = !missing || Boolean(settingsCache.cloudConsent) || cloudImpossible();
    noAiNote.hidden = !(missing && cloudImpossible());
  };
  const log = h('ol', { class: 'log', 'aria-label': 'Where each suggestion was generated' });
  // Says calmly when the cloud refused or could not answer the last request.
  const cloudNote = h('p', { class: 'cloud-note', role: 'status', hidden: true });
  const cloud = h('input', { type: 'checkbox', onchange: (e) => o.settings.set({ cloudConsent: e.target.checked }) });
  const shareBriefing = h('input', { type: 'checkbox', onchange: (e) => o.settings.set({ shareBriefingWithCloud: e.target.checked }) });
  const simulate = h('input', {
    type: 'checkbox',
    onchange: (e) => {
      const eng = o.getEngine();
      if (eng) eng.forceCloud = e.target.checked;
      refreshStatus(); // the status line says that the simulation is on
      o.onSimulate?.(e.target.checked);
    },
  });
  // Declared before put(panes.Live, ...), which calls voiceSection().
  const voiceStatus = h('p', { role: 'status' }, 'Checking the voice…');
  const voiceProgress = h('progress', { max: 1, value: 0, hidden: true, 'aria-label': 'Voice download progress' });
  const voicePick = h('select', { onchange: pickVoice }, ...(o.voice?.list || []).map((v) => h('option', { value: v.id }, `${v.label} (${v.mb} MB)`)));
  const voiceSetup = h('button', { class: 'primary', hidden: true, onclick: () => useVoice(voicePick.value) });
  const voiceTest = h('button', { hidden: true, onclick: () => o.voice.test().catch((e) => (voiceStatus.textContent = 'Voice error: ' + e.message)) }, 'Test the voice');
  put(panes.Live, 
    o.demo ? null : connection,
    h('h2', {}, 'On-device AI'),
    status,
    progress,
    setupBtn,
    tryCloud,
    noAiNote,
    h('h2', {}, 'Cloud fallback'),
    h(
      'label',
      { class: 'check' },
      cloud,
      h('span', {}, h('b', {}, 'Allow the cloud when on-device AI is not available. '), 'Only the last two caption lines are sent to the Gemini API through Firebase, with "Speaker A", "Speaker B" in place of names. What Pipe Up has learned (Memory tab) is never sent.')
    ),
    h(
      'label',
      { class: 'check' },
      shareBriefing,
      h('span', {}, 'Also send relevant briefing excerpts to the cloud. A briefing can contain confidential work information.')
    ),
    cloudNote,
    o.demo ? h('label', { class: 'check' }, simulate, h('span', {}, 'Demo: simulate a computer without Gemini Nano')) : null,
    o.voice ? voiceSection() : null,
    // Open in the demo, where the route is the point; folded in the extension.
    h(
      'details',
      { class: 'routes', open: Boolean(o.demo) },
      h('summary', {}, h('h2', {}, 'Where suggestions were generated')),
      h('p', { class: 'muted' }, 'For each request: on this computer or in the cloud, and why.'),
      log
    )
  );
  function voiceSection() {
    return h(
      'div',
      { class: 'field' },
      h('h2', {}, 'Computer voice in the call'),
      h('p', { class: 'muted' }, 'Optional. A synthetic voice, generated on this computer, reads your chosen reply aloud in the call (choose "Chat + synthetic voice" or "Synthetic voice only" in the call panel). Others hear a computer voice, not yours: you can tell them first: write your own line in Settings, under "Tell others" (Alt+D). Your text never leaves this computer.'),
      h('label', { class: 'field' }, 'Voice', h('span', { class: 'muted' }, 'Each voice is downloaded once, when you first choose it.'), voicePick),
      voiceStatus,
      voiceProgress,
      h('div', { class: 'row' }, voiceSetup, voiceTest)
    );
  }
  let voiceBusy = false; // a voice is being downloaded or started from here
  let voicePicked = false; // the list shows the user's pick, not yet the voice in use
  async function refreshVoice() {
    if (!o.voice || voiceBusy) return;
    const { state, voice } = await o.voice.status();
    if (voiceBusy) return;
    if (!voicePicked) voicePick.value = voice;
    const pick = o.voice.list.find((v) => v.id === voicePick.value);
    // The list shows a voice that is not in use yet: offer to download it.
    const other = state === 'ready' && pick.id !== voice;
    voiceStatus.textContent = other
      ? 'This voice is not on this computer yet. Your current voice stays in use until it is downloaded.'
      : { ready: 'The voice is ready.', loading: 'Starting the voice…', missing: 'The voice is not set up.', failed: 'The voice could not start. Try again.' }[state] || state;
    voiceSetup.hidden = !(other || state === 'missing' || state === 'failed');
    voiceSetup.textContent =
      state === 'failed' ? 'Try again' : other ? `Download this voice (${pick.mb} MB, once)` : `Set up the voice (${pick.mb} MB, once)`;
    voiceTest.hidden = state !== 'ready' || other;
    voicePick.disabled = state === 'loading';
  }
  // A voice already on this computer is used at once; another one is
  // downloaded only when the user asks for it with the button.
  async function pickVoice() {
    voicePicked = true;
    const { state, voice, downloaded } = await o.voice.status();
    if (state === 'ready' && voicePick.value !== voice && downloaded.includes(voicePick.value)) return useVoice(voicePick.value);
    refreshVoice();
  }
  async function useVoice(id) {
    voiceBusy = true;
    voiceSetup.disabled = voicePick.disabled = true;
    voiceTest.hidden = true;
    voiceStatus.textContent = 'Starting the voice…';
    let problem = '';
    try {
      await o.voice.choose(id, (v) => {
        voiceStatus.textContent = 'Downloading the voice…';
        voiceProgress.hidden = false;
        voiceProgress.value = v;
      });
    } catch (e) {
      problem = 'Voice setup failed: ' + (e?.message || e);
    }
    voiceProgress.hidden = true;
    voiceSetup.disabled = voicePick.disabled = false;
    voiceBusy = voicePicked = false;
    await refreshVoice();
    if (problem) voiceStatus.textContent = problem;
  }
  refreshVoice();
  let lastStatus = null;
  let settingsCache = {};

  async function refreshStatus() {
    const s = await deviceStatus();
    lastStatus = s;
    const simulated = s === 'available' && Boolean(o.getEngine()?.forceCloud);
    status.textContent = STATUS_TEXT[simulated ? 'simulated' : s] || s;
    setupBtn.hidden = !(s === 'downloadable' || s === 'downloading');
    showCloudOffer();
    updatePrepButtons();
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
  put(panes.Briefing, 
    h('p', {}, 'Your notes for this call. Pipe Up builds its replies from them. Check each reply before you send it. They stay on this computer unless you choose otherwise.'),
    h('label', { class: 'field' }, h('b', {}, 'My positions'), h('span', { class: 'muted' }, 'Always used first. One per line.'), positions),
    h('label', { class: 'field' }, h('b', {}, 'Write or paste your notes'), notes),
    h('div', { class: 'field' }, h('b', {}, 'Upload a document'), h('span', { class: 'muted' }, '.txt, .md or .pdf, read on this computer'), file, docName, docText),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: saveBriefing }, 'Save briefing'), h('button', { onclick: clearBriefing }, 'Delete briefing')),
    briefInfo
  );
  let briefingDocName = '';
  // Prepared answers ("Prepare for the call"): kept with the briefing.
  let prepared = [];
  o.briefing.get().then((b) => {
    notes.value = b?.notes || '';
    positions.value = b?.positions || '';
    docText.value = b?.documentText || '';
    briefingDocName = b?.documentName || '';
    docName.textContent = briefingDocName || 'No document';
    prepared = Array.isArray(b?.prepared) ? b.prepared.map((q) => ({ question: String(q?.question || ''), answer: String(q?.answer || '') })) : [];
    renderPrepared();
    announce(b);
  });
  function announce(b) {
    const idx = buildBriefingIndex(b || {});
    o.onBriefing(idx);
    const has = idx.chunks.length || idx.positions.length;
    const answers = idx.prepared.length ? `, ${plural(idx.prepared.length, 'prepared answer')}` : '';
    // An answer with a link that is not in the briefing is never offered (core/briefing.js).
    const filled = (b?.prepared || []).filter((q) => String(q?.question || '').trim() && String(q?.answer || '').trim()).length;
    const unused = Math.min(filled, PREPARED_LIMITS.max) - idx.prepared.length;
    const unusedNote = unused > 0 ? ` ${plural(unused, 'prepared answer is', 'prepared answers are')} not used: a link or an e-mail address in ${unused === 1 ? 'it' : 'them'} is not in your briefing.` : '';
    briefInfo.textContent =
      (has || idx.prepared.length ? `Active briefing: ${plural(idx.positions.length, 'position')}, ${plural(idx.chunks.length, 'excerpt')}${answers}.` : 'No active briefing.') + unusedNote;
    // Preparing needs a saved briefing to read.
    prepSection.hidden = !has && !prepared.length;
  }
  const formBriefing = () => {
    const name = file.files?.[0]?.name || briefingDocName;
    return { notes: notes.value, positions: positions.value, documentText: docText.value, documentName: docText.value ? name : '' };
  };
  async function saveBriefing() {
    const b = { ...formBriefing(), prepared: prepared.filter((q) => q.question.trim() || q.answer.trim()) };
    briefingDocName = b.documentName;
    await o.briefing.set(b, { byUser: true });
    announce(b);
  }
  async function clearBriefing() {
    notes.value = positions.value = docText.value = '';
    file.value = '';
    briefingDocName = '';
    docName.textContent = 'No document';
    // The prepared answers are part of the briefing: they go with it.
    prepRun?.abort();
    prepared = [];
    closeConfirm();
    prepStatus.textContent = '';
    renderPrepared();
    await o.briefing.set({}, { byUser: true });
    announce({});
  }

  // ---------- Briefing: prepare for the call ----------
  // Cloud before the call, device during the call: a cloud model may read
  // the whole briefing once, after an explicit click; the answers it
  // prepares are then used on this computer.
  const nf = (n) => Number(n).toLocaleString('en-US');
  const prepCloud = h('button', { class: 'primary', onclick: () => askPrepare('cloud', prepCloud) }, 'Prepare with the cloud');
  const prepDevice = h('button', { onclick: () => askPrepare('device', prepDevice) }, 'Prepare on this computer');
  const prepDeviceNote = h('p', { class: 'muted', id: 'pu-prep-device-note', hidden: true }, 'Preparing on this computer needs Gemini Nano (see the Live tab).');
  const confirmText = h('div', { tabindex: '-1' });
  const confirmGo = h('button', { class: 'primary' }, 'Continue');
  const confirmBox = h(
    'div',
    { class: 'confirm', role: 'group', 'aria-label': 'Confirm the preparation', hidden: true },
    confirmText,
    h('div', { class: 'row' }, confirmGo, h('button', { onclick: () => closeConfirm(true) }, 'Cancel'))
  );
  const prepProgress = h('progress', { hidden: true, 'aria-label': 'Preparation progress' });
  const prepStop = h('button', { hidden: true, onclick: () => prepRun?.abort() }, 'Stop');
  const prepStatus = h('p', { class: 'muted', role: 'status' });
  const prepHint = h('p', { hidden: true }, h('b', {}, 'Check and edit: these are your answers, in your words.'));
  const prepList = h('ol', { class: 'qa', 'aria-label': 'Prepared questions and answers' });
  const prepAdd = h('button', { onclick: addPrepared }, 'Add a question');
  const prepSection = h(
    'section',
    { class: 'prep', 'aria-labelledby': 'pu-prep-title', hidden: true },
    h('h2', { id: 'pu-prep-title', tabindex: '-1' }, 'Prepare for the call'),
    h('p', {}, 'Turn your briefing into the questions you are likely to get, each with a short answer. During the call, Pipe Up uses them on this computer.'),
    h('div', { class: 'row' }, prepCloud, prepDevice),
    h(
      'p',
      { class: 'muted' },
      `The cloud reads up to ${nf(PREP_LIMITS.cloudWords)} words in one request, after you confirm. This computer reads up to ${nf(PREP_LIMITS.devicePartWords * PREP_LIMITS.deviceParts)} words, part by part, and sends nothing.`
    ),
    prepDeviceNote,
    confirmBox,
    prepProgress,
    h('div', { class: 'row' }, prepStop),
    prepStatus,
    prepHint,
    prepList,
    h('div', { class: 'row' }, prepAdd)
  );
  put(panes.Briefing, prepSection);

  let prepRun = null; // AbortController of the preparation in progress
  let confirmOrigin = null;

  function updatePrepButtons() {
    const nano = lastStatus === 'available' && !o.getEngine()?.forceCloud;
    prepCloud.disabled = Boolean(prepRun);
    prepDevice.disabled = Boolean(prepRun) || !nano;
    prepDeviceNote.hidden = nano;
    // The reason is tied to the button only while it applies.
    if (nano) prepDevice.removeAttribute('aria-describedby');
    else prepDevice.setAttribute('aria-describedby', prepDeviceNote.id);
  }

  function closeConfirm(backToButton = false) {
    confirmBox.hidden = true;
    if (backToButton) confirmOrigin?.focus();
    confirmOrigin = null;
  }

  // One inline question before anything is sent or replaced. For the cloud
  // this click is the consent for that single request: it does not turn on
  // the standing cloud options of the Live tab.
  function askPrepare(target, origin) {
    const plan = planPreparation(formBriefing(), target);
    if (!plan.parts.length) {
      prepStatus.textContent = PREP_PROBLEMS.empty;
      return;
    }
    // Remote Config kill switch: say so before asking to confirm anything.
    if (target === 'cloud' && o.getEngine() && !o.getEngine().remote.cloud_enabled) {
      prepStatus.textContent = PREP_PROBLEMS['cloud-off'];
      return;
    }
    const lines = [];
    if (target === 'cloud') {
      lines.push(`This sends your briefing text (about ${nf(plan.words)} words) to the Gemini API through Firebase, once.`);
      if (plan.shortened) lines.push(`Your briefing has about ${nf(plan.total)} words: only the first ${nf(plan.limit)} are sent.`);
      lines.push('Nothing else is sent, and this does not turn on the cloud for the call.');
    } else if (plan.shortened) {
      lines.push(`Your briefing has about ${nf(plan.total)} words: Gemini Nano reads the first ${nf(plan.limit)} on this computer.`);
    }
    const kept = prepared.filter((q) => q.question.trim() || q.answer.trim()).length;
    if (kept) lines.push(`This replaces the ${kept} prepared answer${kept === 1 ? '' : 's'} below.`);
    if (!lines.length) return runPrepare(target, origin); // on this computer, nothing to lose: no question to ask
    confirmText.replaceChildren(...lines.map((l) => h('p', {}, l)));
    confirmGo.onclick = () => runPrepare(target, origin);
    confirmOrigin = origin;
    confirmBox.hidden = false;
    // Focus goes to the explanation, not to "Continue": a held Enter key
    // must not confirm by itself.
    confirmText.focus();
  }

  const PREP_PROBLEMS = {
    empty: 'Write your positions or notes first, then prepare.',
    'cloud-off': 'The cloud is switched off for now. You can prepare on this computer.',
    'no-device': 'Gemini Nano is not ready on this computer (see the Live tab).',
    cancelled: 'Stopped. Nothing was changed.',
  };

  async function runPrepare(target, origin) {
    closeConfirm();
    const eng = o.getEngine();
    if (!eng) {
      prepStatus.textContent = 'Pipe Up is still starting. Try again in a moment.';
      return;
    }
    prepRun = new AbortController();
    updatePrepButtons();
    prepProgress.removeAttribute('value'); // "working", until the parts are counted
    prepProgress.hidden = prepStop.hidden = false;
    prepStop.focus();
    prepStatus.textContent = target === 'cloud' ? 'Sending your briefing to the cloud…' : 'Reading your briefing on this computer…';
    const t0 = performance.now();
    let focusNext = origin; // where the focus goes when "Stop" disappears
    try {
      await saveBriefing(); // what is prepared is the briefing as saved
      const res = await eng.prepare(await o.briefing.get(), {
        target,
        signal: prepRun.signal,
        onProgress: (done, total) => {
          prepProgress.max = total;
          prepProgress.value = done;
          if (target === 'device' && done < total) prepStatus.textContent = `Reading your briefing on this computer: part ${done + 1} of ${total}…`;
        },
      });
      reportPreparation(res, target);
      if (!res.items.length) {
        prepStatus.textContent = 'No likely question was found in your briefing. Add a few details and try again.';
        return;
      }
      prepared = res.items.map((q) => ({ ...q }));
      await storePrepared();
      renderPrepared();
      const n = res.items.length;
      const where = res.route === 'in_cloud' ? 'with the cloud' : target === 'cloud' ? 'on this computer, because the cloud request failed' : 'on this computer';
      prepStatus.textContent = [
        `${n} question${n === 1 ? '' : 's'} prepared ${where}.`,
        res.dropped ? `${res.dropped} answer${res.dropped === 1 ? ' was' : 's were'} left out: a number or a link in ${res.dropped === 1 ? 'it' : 'them'} is not in your briefing.` : '',
        res.shortened ? `Your briefing was shortened to its first ${nf(res.words)} words.` : '',
      ]
        .filter(Boolean)
        .join(' ');
      focusNext = prepList.querySelector('textarea') || origin; // on to the review
    } catch (e) {
      // The technical reason (the SDK's own words, without the request
      // address) goes to the log's tooltip and the console, not on screen.
      const why = String(e?.message || e).replace(/^.*Error fetching from \S+\s*/, '').slice(0, 160);
      let text = 'The preparation did not work this time.';
      if (target === 'cloud') {
        text = 'The cloud could not prepare your answers this time.';
        // The extension reaches the cloud only with an App Check token.
        if (cloudImpossible()) text += ' In this extension the cloud needs an App Check token (Settings tab).';
        text += ' You can prepare on this computer if Gemini Nano is ready.';
      }
      prepStatus.textContent = PREP_PROBLEMS[e?.code] || text;
      if (e?.code !== 'cancelled' && e?.code !== 'empty') {
        if (!PREP_PROBLEMS[e?.code]) console.warn('[Pipe Up] preparation failed', e);
        const problem = PREP_PROBLEMS[e?.code] || (target === 'cloud' ? 'The cloud request failed; nothing was prepared' : 'Gemini Nano could not prepare the answers');
        reportPreparation({ route: 'failed', mode: e?.mode, items: [], ms: Math.round(performance.now() - t0), problem, error: PREP_PROBLEMS[e?.code] ? '' : why }, target);
      }
    } finally {
      prepRun = null;
      prepProgress.hidden = prepStop.hidden = true;
      updatePrepButtons(); // the buttons are usable again before one takes the focus
      focusNext.focus();
    }
  }

  // Saved at once, on this computer, with the briefing. The list on screen is
  // not rebuilt here, so the field being edited keeps the focus.
  // `byUser`: the user typed or deleted an answer (the hosted demo needs to
  // know when the briefing stops being the fictional sample).
  async function storePrepared(byUser = false) {
    const b = { ...(await o.briefing.get()), prepared: prepared.filter((q) => q.question.trim() || q.answer.trim()) };
    await o.briefing.set(b, { byUser });
    announce(b);
  }

  function renderPrepared() {
    prepHint.hidden = !prepared.length;
    prepAdd.hidden = prepared.length >= PREPARED_LIMITS.max;
    prepList.replaceChildren(
      ...prepared.map((q, i) => {
        const edit = (key) => (e) => {
          q[key] = e.target.value;
        };
        // One row that grows (panel.css .grow): a long question is never cut. Enter does not add a line.
        const question = h('textarea', { class: 'q grow', rows: 1, maxlength: String(PREPARED_LIMITS.questionChars), oninput: edit('question'), onchange: () => storePrepared(true), onkeydown: (e) => e.key === 'Enter' && e.preventDefault() }, q.question);
        const answer = h('textarea', { class: 'a grow', rows: 2, maxlength: String(PREPARED_LIMITS.answerChars), oninput: edit('answer'), onchange: () => storePrepared(true) }, q.answer);
        return h(
          'li',
          {},
          h('label', { class: 'field' }, h('span', { class: 'muted' }, `Question ${i + 1}`), question),
          h('label', { class: 'field' }, h('span', { class: 'muted' }, 'My answer'), answer),
          h('button', { class: 'link', 'aria-label': `Delete question ${i + 1}`, onclick: () => deletePrepared(i) }, 'Delete')
        );
      })
    );
  }

  function addPrepared() {
    prepared.push({ question: '', answer: '' });
    renderPrepared();
    prepSection.hidden = false;
    prepList.lastElementChild.querySelector('textarea').focus();
  }

  async function deletePrepared(i) {
    prepared.splice(i, 1);
    renderPrepared();
    // Focus stays in the list: the next question, or "Add a question".
    (prepList.children[Math.min(i, prepared.length - 1)]?.querySelector('textarea') || prepAdd).focus();
    await storePrepared(true);
    prepStatus.textContent = `Deleted. ${prepared.length} prepared answer${prepared.length === 1 ? '' : 's'} left.`;
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
  put(panes.Memory, 
    h('h2', {}, 'What Pipe Up has learned'),
    h(
      'p',
      { class: 'muted' },
      `Stored only on this computer, for ${MEMORY_LIMITS.retentionDays} days and ${MEMORY_LIMITS.maxEvents} entries at most, and used as examples of your style. Each entry holds: the reply you sent, the suggestions that were shown, and up to ${MEMORY_LIMITS.keyWords} key words of the caption line it answered (shown below as "Key words"). No audio and no full caption sentence is kept. With "Don't learn from my replies", nothing is added.`
    ),
    rate,
    h('button', { onclick: () => (confirmRow.hidden = false) }, 'Delete everything'),
    confirmRow,
    list
  );
  async function renderMemory() {
    const events = (await o.memory.all()).reverse();
    const r = adoptionRate(events);
    const moments = events.filter((e) => e.shown?.length).length;
    const used = events.filter((e) => e.shown?.length && (e.action === 'picked' || e.action === 'edited')).length;
    rate.textContent = r == null ? 'No data yet.' : `You used a suggestion in ${used} of ${moments} moments. Speaking yourself counts just as much.`;
    list.replaceChildren(
      ...events.slice(0, 200).map((e) => {
        const what = `${ACTION_LABEL[e.action] || e.action} · ${new Date(e.ts).toLocaleString()}`;
        return h(
          'li',
          {},
          h('div', { class: 'muted' }, what),
          e.keys?.length ? h('div', { class: 'muted' }, 'Key words: ' + e.keys.join(', ')) : null,
          e.shown?.length ? h('div', { class: 'muted' }, 'Suggestions shown: ' + e.shown.join(' · ')) : null,
          e.reply ? h('div', {}, '→ ', h('b', {}, e.reply)) : null,
          // Several "Delete" buttons in a row: each one says what it deletes.
          h('button', { class: 'link', 'aria-label': `Delete this entry: ${what}`, onclick: async () => { await o.memory.remove(e.id); renderMemory(); } }, 'Delete')
        );
      })
    );
  }

  // ---------- Settings ----------
  const mode = h('select', {}, h('option', { value: 'auto' }, 'After each pause'), h('option', { value: 'onDemand' }, 'Only when I ask (Alt+S)'));
  const myName = h('input', { type: 'text', placeholder: 'e.g. Sam Taylor', autocomplete: 'off' });
  const fillerInputs = [0, 1, 2].map(() => h('input', { type: 'text' }));
  const raiseHandBox = h('input', { type: 'checkbox', onchange: (e) => o.settings.set({ raiseHandOnHold: e.target.checked }) });
  const disclosure = h('input', { type: 'text' });
  // Applies at once, like the display options below.
  const scale = h('select', { onchange: (e) => o.settings.set({ textScale: Number(e.target.value) }) }, ...[['1', 'Normal'], ['1.15', 'Large'], ['1.3', 'Extra large']].map(([v, l]) => h('option', { value: v }, l)));
  const token = h('input', { type: 'password', placeholder: 'App Check debug token (optional)', autocomplete: 'off' });
  // Display and reading options apply at once, in the call panel and here.
  const DISPLAY = [
    ['easyReading', 'Easy reading', 'More space between letters and lines, larger text, and shorter replies (8 words at most). Helpful with dyslexia or when reading under pressure.'],
    ['compact', 'One suggestion at a time', 'Less to read: only the best reply is shown.'],
    ['hearSuggestions', 'Hear the suggestions:', 'a reading aid, like a screen reader, in your own headphones.'],
    ['highContrast', 'High contrast', 'Black and white with a yellow highlight. Nothing relies on color alone.'],
    ['reduceMotion', 'Reduce motion', 'No transitions. Pipe Up also follows your system setting.'],
  ];
  const displayBoxes = Object.fromEntries(
    DISPLAY.map(([key]) => [key, h('input', { type: 'checkbox', onchange: (e) => o.settings.set({ [key]: e.target.checked }) })])
  );
  const saved = h('span', { class: 'muted', role: 'status' });
  put(panes.Settings, 
    h('h2', {}, 'Suggestions'),
    h('label', { class: 'field' }, 'When to suggest replies', mode),
    o.demo ? null : h('label', { class: 'field' }, 'Your name as shown in Meet captions', h('span', { class: 'muted' }, 'Only needed if Meet does not label you "You", so your own words never trigger suggestions.'), myName),
    h('h2', {}, 'Quick phrases'),
    h('p', { class: 'muted' }, 'Sent at once with a click or Alt+1, Alt+2, Alt+3. The first one holds the floor while you speak.'),
    ...fillerInputs.map((inp, i) => h('label', { class: 'field' }, `Phrase ${i + 1}`, inp)),
    // Meet only: the demo call has no raise-hand button.
    o.demo
      ? null
      : h(
          'label',
          { class: 'check' },
          raiseHandBox,
          h('span', {}, h('b', {}, 'Also raise my hand in Meet when I send "I\'m still speaking". '), 'Applies to your first quick phrase (Alt+1). Others see your hand raised, as when you click Meet\'s own button. Off by default.')
        ),
    h('label', { class: 'field' }, 'Tell others, if you want to (Alt+D)', h('span', { class: 'muted' }, 'Optional. Your words, your choice. Example: "I stutter. Sometimes I answer in the chat."'), disclosure),
    h('label', { class: 'field' }, 'Text size', scale),
    h('h2', {}, 'Display and reading'),
    h('p', { class: 'muted' }, 'Options, all off by default. They apply at once.'),
    ...DISPLAY.map(([key, label, help]) => h('label', { class: 'check' }, displayBoxes[key], h('span', {}, h('b', {}, /[.:]$/.test(label) ? label + ' ' : label + '. '), help))),
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
  // Typed but not yet saved: other setting changes must not overwrite it.
  let formDirty = false;
  for (const inp of [mode, myName, ...fillerInputs, disclosure]) inp.addEventListener('input', () => (formDirty = true));
  async function saveSettings() {
    formDirty = false;
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
    if (!formDirty) {
      mode.value = s.suggestMode || 'auto';
      myName.value = s.myName || '';
      fillerInputs.forEach((inp, i) => (inp.value = s.fillers?.[i] || ''));
      disclosure.value = s.disclosure || '';
    }
    scale.value = String(s.textScale || 1);
    for (const [key, box] of Object.entries(displayBoxes)) box.checked = Boolean(s[key]);
    raiseHandBox.checked = Boolean(s.raiseHandOnHold);
    root.classList.toggle('pu-easy', Boolean(s.easyReading));
    root.classList.toggle('pu-contrast', Boolean(s.highContrast));
    root.classList.toggle('pu-still', Boolean(s.reduceMotion));
    if (o.debugToken) token.value = o.debugToken.get();
    showCloudOffer();
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
      const used = res.usedPrepared ? ' · used your prepared answer' : res.hasBriefing ? ' · used your briefing' : '';
      addLog(res.route, ` ${res.ms} ms${res.headStartMs ? ` (started ${res.headStartMs} ms before the pause)` : ''}`, res.reason + used, res.error);
      // The note stays until a later request goes through.
      cloudNote.hidden = !res.cloudProblem;
      cloudNote.textContent = CLOUD_PROBLEM_TEXT[res.cloudProblem] || '';
      if (current === 'Memory') renderMemory();
    },
    /** Opens the Briefing tab on "Prepare for the call". False when there is no briefing yet. */
    showPrepare() {
      show('Briefing');
      if (prepSection.hidden) return false;
      prepSection.scrollIntoView({ block: 'start' });
      (prepCloud.disabled ? prepSection.querySelector('h2') : prepCloud).focus();
      return true;
    },
    renderMemory,
  };

  // One line of the "Where suggestions were generated" log.
  // `technical`: the raw error, kept as a tooltip for whoever debugs.
  function addLog(route, what, detail, technical) {
    const item = h(
      'li',
      technical ? { title: technical } : {},
      h('span', { class: 'route ' + route }, ROUTE_TEXT[route] || route),
      `${what} · ${new Date().toLocaleTimeString()}`,
      h('div', { class: 'muted' }, detail)
    );
    log.prepend(item);
    while (log.children.length > 10) log.lastChild.remove();
  }

  // A preparation is logged like a suggestion, with the route Firebase AI
  // Logic really took (inferenceSource), e.g. "Cloud · preparation · 5 Q&A · 3.2 s".
  function reportPreparation(res, target) {
    // The hybrid mode that was really asked for (core/engine.js prepare).
    const mode = res.mode || (target === 'cloud' ? 'cloud' : 'ONLY_ON_DEVICE');
    let detail = res.problem;
    if (res.route === 'in_cloud') detail = `Your briefing text (${nf(res.words)} words) was sent once to the Gemini API through Firebase`;
    else if (res.route === 'on_device' && target === 'cloud') detail = 'The cloud request failed, so Gemini Nano did it on this computer';
    else if (res.route === 'on_device') detail = `Gemini Nano read your briefing on this computer (${res.parts} part${res.parts === 1 ? '' : 's'}); nothing was sent`;
    addLog(res.route, ` · preparation · ${res.items.length} Q&A · ${(res.ms / 1000).toFixed(1)} s`, `${detail} (${mode})`, res.error);
  }
}
