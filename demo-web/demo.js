// Hosted demo: the same engine and interface as the extension, on a
// simulated call, so anyone can try Pipe Up without a Meet meeting.
import { ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { initFirebase, SuggestionEngine, deviceStatus } from '../core/engine.js';
import { IdbMemoryStore, makeEvent } from '../core/memory.js';
import { DEFAULT_SETTINGS, migrateSettings } from '../core/config.js';
import { createOverlay } from '../shared/overlay.js';
import { mountControls } from '../shared/controls.js';
import { setPdfWorker } from '../shared/extract.js';

/* global __FIREBASE_CONFIG__, __RECAPTCHA_SITE_KEY__ */
setPdfWorker(new URL('pdf.worker.min.mjs', location.href).href);

const SCRIPT = [
  ['Maya', 'Morning everyone. Sam, can you give us a quick update on the vendor contract?'],
  ['Jordan', 'Do we still think the March deadline is realistic?'],
  ['Maya', 'Did everyone get the slides I sent yesterday?'],
  ['Jordan', 'Should we bring in a second vendor to reduce the risk?'],
  ['Maya', 'Okay. Anything else before we wrap up?'],
];
const SAMPLE_BRIEFING = {
  positions:
    'The vendor contract is signed except the penalty clause; legal reviews it on Friday.\n' +
    'I want to keep the March deadline if QA can start on February 10.\n' +
    'I am against a second vendor: it would double the onboarding work.',
  notes:
    'Project status for the weekly sync. Vendor: Northwind Logistics. Contract signed on all points except the late-delivery penalty clause, which legal reviews on Friday. ' +
    'Timeline: March release holds if QA starts February 10; the risk is the API migration. I sent the risk log to Maya on Monday.',
};

// ---- storage (per browser, wrapped because storage can be blocked) ----
const local = {
  read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode: keep in memory only */
    }
  },
};
let settings = migrateSettings(local.read('pu-settings', {}));
const listeners = [];
const settingsStore = {
  async get() {
    return settings;
  },
  async set(patch) {
    settings = { ...settings, ...patch };
    local.write('pu-settings', settings);
    listeners.forEach((fn) => fn(settings));
  },
};
let briefingCache = local.read('pu-briefing', {});
const briefingStore = {
  async get() {
    return briefingCache;
  },
  async set(b) {
    briefingCache = b;
    local.write('pu-briefing', b);
  },
};

const memory = new IdbMemoryStore('pipe-up-demo');
let briefingIndex = null;
let engine = null;

const controls = mountControls(document.getElementById('app'), {
  getEngine: () => engine,
  memory,
  settings: settingsStore,
  briefing: briefingStore,
  onBriefing: (idx) => (briefingIndex = idx),
  demo: true,
});

const overlay = createOverlay(
  {
    onSend: ({ text, action, choice, shown, context }) => {
      deliver(text);
      learn({ action, reply: text, choice, shown, context });
    },
    onSpoke: ({ shown, context }) => {
      addChat('Sam', '(answered out loud)');
      learn({ action: 'spoke', reply: '', shown, context });
    },
    onDismiss: ({ shown, context }) => learn({ action: 'dismissed', reply: '', shown, context }),
    onSettings: (patch) => settingsStore.set(patch),
    onRequest: () => (history.length ? ask(history.slice(-3)) : overlay.notice('Start the call first.')),
  },
  { position: { right: '380px', bottom: '24px' } }
);
overlay.setSettings(settings);
overlay.setVoiceAvailable('speechSynthesis' in window);
listeners.push((s) => {
  overlay.setSettings(s);
  controls.applySettings(s);
  updateBanner();
});

function learn(e) {
  if (settings.dontLearn) return;
  memory.add(makeEvent(e)).then(() => controls.renderMemory());
}

function deliver(text) {
  const mode = settings.outputMode;
  if (mode !== 'voice') addChat('Sam', text);
  if (mode !== 'chat' && 'speechSynthesis' in window) {
    // In the demo the voice plays on your speakers. In a Meet call the
    // extension mixes a local voice into the microphone stream.
    speechSynthesis.cancel();
    speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), { lang: 'en-US', rate: 1 }));
  }
}

function addChat(who, text) {
  const li = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = who + ': ';
  li.append(b, text);
  document.getElementById('chat').append(li);
}

// ---- banner for computers without Gemini Nano (judges, phones, other browsers) ----
const banner = document.getElementById('nano-banner');
async function updateBanner() {
  const s = await deviceStatus();
  banner.hidden = s === 'available' || settings.cloudConsent;
}
// Sam's briefing is fictional, so the demo also shares its excerpts with the
// cloud; otherwise a judge without Gemini Nano never sees grounded replies.
document.getElementById('try-cloud').addEventListener('click', () => settingsStore.set({ cloudConsent: true, shareBriefingWithCloud: true }));
updateBanner();

// ---- simulated captions and one request at a time ----
const captions = document.getElementById('captions');
const history = [];
let step = 0;
let timer = null;
let requestId = 0;
let busy = false;
let pending = null;

function say(speaker, text) {
  history.push({ speaker, text });
  captions.replaceChildren(
    ...history.slice(-2).map((l) => {
      const p = document.createElement('div');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = l.speaker;
      p.append(who, l.text);
      return p;
    })
  );
  document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('speaking', t.dataset.name === speaker));
  overlay.setLine(speaker, text);
  if (settings.suggestMode === 'onDemand') {
    scheduleAutoNext();
    return overlay.notice('Press Alt+S (or the button) when you want suggestions.');
  }
  // Simulates Meet's pause detection.
  setTimeout(() => ask(history.slice(-3)), Number(engine?.remote.pause_ms) || 1200);
}

function ask(lines) {
  const id = ++requestId;
  overlay.setThinking(lines.at(-1)?.text);
  pending = { id, lines };
  if (!busy) drain();
}

async function drain() {
  busy = true;
  try {
    while (pending) {
      const job = pending;
      pending = null;
      if (!engine) await engineReady;
      const res = await engine.suggest(job.lines, {
        onPartial: (r) => job.id === requestId && overlay.setPartial(r),
      });
      controls.reportRun(res);
      if (job.id !== requestId) continue; // a newer line arrived meanwhile
      overlay.setSuggestions(res.replies, res.route, job.lines.at(-1)?.text);
      scheduleAutoNext();
      if (res.route === 'blocked') overlay.notice('On-device AI is not available here. Use "Try with the cloud" above to continue.');
      if (res.error) console.warn('[Pipe Up]', res.error);
    }
  } finally {
    busy = false;
  }
}

const nextBtn = document.getElementById('next');
nextBtn.addEventListener('click', () => {
  if (step >= SCRIPT.length) step = 0;
  const [who, text] = SCRIPT[step++];
  nextBtn.textContent = step >= SCRIPT.length ? 'Restart the call' : 'Next line';
  say(who, text);
});
// Auto-play: plays the scripted call line by line. After each set of
// suggestions it leaves 8 seconds to read them, waits while you pick or edit
// one, and stops at the end of the script.
const autoBtn = document.getElementById('auto');
let autoOn = false;
function setAuto(on) {
  autoOn = on;
  autoBtn.setAttribute('aria-pressed', String(on));
  autoBtn.textContent = on ? 'Stop auto-play' : 'Auto-play';
  clearTimeout(timer);
}
function scheduleAutoNext(delay = 8000) {
  if (!autoOn) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!autoOn) return;
    if (overlay.isEngaged() || busy) return scheduleAutoNext(2000);
    if (step >= SCRIPT.length) return setAuto(false);
    nextBtn.click();
  }, delay);
}
autoBtn.addEventListener('click', () => {
  setAuto(!autoOn);
  if (!autoOn) return;
  if (step >= SCRIPT.length) step = 0;
  nextBtn.click(); // start right away
});
document.getElementById('say').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('sayText');
  if (input.value.trim()) say('Maya', input.value.trim());
  input.value = '';
});
const sampleBtn = document.getElementById('sample');
if (briefingCache?.positions || briefingCache?.docs?.length) sampleBtn.textContent = "Reload Sam's sample briefing";
sampleBtn.addEventListener('click', async () => {
  await briefingStore.set(SAMPLE_BRIEFING);
  location.reload();
});

const engineReady = initFirebase({
  firebaseConfig: __FIREBASE_CONFIG__,
  appCheck: __RECAPTCHA_SITE_KEY__ ? { provider: new ReCaptchaEnterpriseProvider(__RECAPTCHA_SITE_KEY__) } : {},
}).then((firebase) => {
  engine = new SuggestionEngine({
    firebase,
    memory,
    getBriefing: () => briefingIndex,
    getSettings: () => settings,
  });
  engine.warmUp();
  return engine;
});
