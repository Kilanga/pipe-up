// Hosted demo: the same engine and interface as the extension, on a
// simulated call, so anyone can try Pipe Up without a Meet meeting.
import { initFirebase, SuggestionEngine } from '../core/engine.js';
import { IdbMemoryStore, makeEvent } from '../core/memory.js';
import { DEFAULT_SETTINGS } from '../core/config.js';
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
let settings = { ...DEFAULT_SETTINGS, ...local.read('pu-settings', {}) };
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
let context = '';

const controls = mountControls(document.getElementById('app'), {
  getEngine: () => engine,
  memory,
  settings: settingsStore,
  briefing: briefingStore,
  onBriefing: (idx) => (briefingIndex = idx),
  demoSwitch: true,
});

const overlay = createOverlay({
  onSend: ({ text, action, choice, shown }) => {
    deliver(text);
    learn({ action, reply: text, choice, shown });
  },
  onSpoke: (shown) => {
    addChat('Sam (spoke)', '(answered out loud)');
    learn({ action: 'spoke', reply: '', shown });
  },
  onDismiss: (shown) => learn({ action: 'dismissed', reply: '', shown }),
  onSettings: (patch) => settingsStore.set(patch),
}, { position: { right: '380px', bottom: '24px' } });
overlay.setSettings(settings);
listeners.push((s) => {
  overlay.setSettings(s);
  controls.applySettings(s);
});

function learn(e) {
  if (settings.dontLearn) return;
  memory.add(makeEvent({ context, ...e })).then(() => controls.renderMemory());
}

function deliver(text) {
  const mode = settings.outputMode;
  if (mode !== 'voice') addChat('Sam', text);
  if (mode !== 'chat' && 'speechSynthesis' in window) {
    // In the demo the voice plays on your speakers. In a real call the
    // extension mixes a local voice into the microphone stream.
    speechSynthesis.cancel();
    speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), { lang: 'en-US', rate: 1 }));
  }
}

function addChat(who, text) {
  const li = document.createElement('li');
  li.innerHTML = '<b></b> ';
  li.firstChild.textContent = who + ':';
  li.append(text);
  document.getElementById('chat').append(li);
}

// ---- simulated captions ----
const captions = document.getElementById('captions');
const history = [];
let step = 0;
let timer = null;

async function say(speaker, text) {
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
  document.querySelectorAll('.tile').forEach((t) => t.classList.toggle('speaking', t.textContent.startsWith(speaker)));
  overlay.setLine(speaker, text);
  context = text;
  overlay.setThinking();
  // Simulate Meet's pause detection.
  await new Promise((r) => setTimeout(r, Number(engine?.remote.pause_ms) || 1200));
  if (!engine) return overlay.notice('The AI engine is still starting…');
  const res = await engine.suggest(history.slice(-3));
  overlay.setSuggestions(res.replies, res.route);
  controls.reportRun(res);
  if (res.route === 'blocked') overlay.notice('On-device AI is not available here. Allow the cloud in the panel on the right to continue.');
  if (res.error) console.warn('[Pipe Up]', res.error);
}

const nextBtn = document.getElementById('next');
nextBtn.addEventListener('click', () => {
  if (step >= SCRIPT.length) step = 0;
  const [who, text] = SCRIPT[step++];
  nextBtn.textContent = step >= SCRIPT.length ? 'Restart the call' : 'Next line';
  say(who, text);
});
document.getElementById('auto').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  e.currentTarget.textContent = on ? 'Stop auto-play' : 'Auto-play';
  clearInterval(timer);
  if (on) timer = setInterval(() => !overlay.hasSuggestions() && nextBtn.click(), 9000);
});
document.getElementById('say').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('sayText');
  if (input.value.trim()) say('Maya', input.value.trim());
  input.value = '';
});
document.getElementById('sample').addEventListener('click', async () => {
  await briefingStore.set(SAMPLE_BRIEFING);
  location.reload();
});

initFirebase({
  firebaseConfig: __FIREBASE_CONFIG__,
  appCheck: { kind: 'recaptcha', siteKey: __RECAPTCHA_SITE_KEY__ },
}).then((firebase) => {
  engine = new SuggestionEngine({
    firebase,
    memory,
    getBriefing: () => briefingIndex,
    getSettings: () => settings,
  });
});
