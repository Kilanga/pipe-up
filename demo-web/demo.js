// Hosted demo: the same engine and interface as the extension, on a
// simulated call, so anyone can try Pipe Up without a Meet meeting.
import { ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { initFirebase, lazyAppCheckProvider, SuggestionEngine, deviceStatus } from '../core/engine.js';
import { IdbMemoryStore, makeEvent } from '../core/memory.js';
import { migrateSettings, CLOUD_PROBLEM_TEXT } from '../core/config.js';
import { SuggestionRunner } from '../core/runner.js';
import { createPauseTimer } from '../core/pause.js';
import { speakPrivately } from '../shared/private-speech.js';
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
    'Project status for the weekly sync. Vendor: Zorvex Freight (an invented name). Contract signed on all points except the late-delivery penalty clause, which legal reviews on Friday. ' +
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
  // A choice made by the user in the interface. Ticking or unticking
  // "send briefing excerpts" there is theirs from then on (see autoShare).
  async set(patch) {
    if ('shareBriefingWithCloud' in patch) patch = { ...patch, demoAutoShare: false };
    return applyPatch(patch);
  },
};
async function applyPatch(patch) {
  settings = { ...settings, ...patch };
  local.write('pu-settings', settings);
  listeners.forEach((fn) => fn(settings));
}
let briefingCache = local.read('pu-briefing', {});
const briefingStore = {
  async get() {
    return briefingCache;
  },
  async set(b, { byUser = false } = {}) {
    // An answer typed or changed by the user is their own text.
    if (byUser && JSON.stringify(b.prepared || []) !== JSON.stringify(briefingCache.prepared || [])) ownAnswers = true;
    if (!b.prepared?.length) ownAnswers = false;
    local.write('pu-own-answers', ownAnswers);
    briefingCache = b;
    local.write('pu-briefing', b);
    stopAutoShare();
    updateBanner();
  },
};

// ---- Sam's sample is fictional; anything else may be real ----
// "Try with the cloud" also sends briefing excerpts, but only while the
// briefing is Sam's unmodified sample. As soon as the user edits it, adds a
// document or writes an answer, that automatic sharing stops and is said;
// sending their own text is then an explicit choice in the Live tab.
let ownAnswers = Boolean(local.read('pu-own-answers', false));
function briefingIsOwn(b = briefingCache) {
  const has = Boolean(b?.positions || b?.notes || b?.documentText || b?.prepared?.length);
  const sample = (b?.positions || '') === SAMPLE_BRIEFING.positions && (b?.notes || '') === SAMPLE_BRIEFING.notes && !b?.documentText;
  return has && (!sample || ownAnswers);
}
const shareNote = document.getElementById('share-note');
function stopAutoShare() {
  if (!settings.demoAutoShare || !briefingIsOwn()) return;
  applyPatch({ shareBriefingWithCloud: false, demoAutoShare: false });
  shareNote.hidden = false;
  shareNote.textContent =
    "This briefing is no longer Sam's sample, so it is not sent to the cloud any more. To send excerpts of your own text, tick \"Also send relevant briefing excerpts to the cloud\" in the Live tab.";
}

const memory = new IdbMemoryStore('pipe-up-demo');
let briefingIndex = null;
let engine = null;

const controls = mountControls(document.getElementById('app'), {
  getEngine: () => engine,
  memory,
  settings: settingsStore,
  briefing: briefingStore,
  onBriefing: (idx) => (briefingIndex = idx),
  onSimulate: () => updateBanner(),
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
    onHear: (text) => speakPrivately(text) || overlay.notice('No local voice in this browser to read the suggestions.'),
  },
  { mount: document.getElementById('overlay-slot'), inline: true }
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
  // In the demo the voice plays on your speakers, with a voice installed on
  // this computer only: the browser's default voice may be an online one,
  // which would send the text away. (In a Meet call the extension mixes its
  // own local voice into the microphone stream.)
  const spoken = mode !== 'chat' && speakPrivately(text);
  if (mode !== 'voice' || !spoken) addChat('Sam', text);
  // (After the panel's own "Sent" message, which would replace it.)
  if (mode !== 'chat' && !spoken) setTimeout(() => overlay.notice('No voice installed on this computer to read the reply: it went to the chat.'));
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
const bannerWhy = document.getElementById('nano-why');
const bannerData = document.getElementById('nano-data');
const BANNER_WHY = {
  simulated: 'You are simulating a computer without Gemini Nano.',
  downloadable: 'Gemini Nano is not set up on this computer yet. You can set it up in the Live tab (one download, several minutes).',
  downloading: 'Gemini Nano is still downloading on this computer (see the Live tab).',
  unavailable: 'Gemini Nano is not available on this computer.',
  unsupported: 'This browser does not offer Gemini Nano.',
};
async function updateBanner() {
  const s = await deviceStatus();
  const simulated = s === 'available' && Boolean(engine?.forceCloud);
  banner.hidden = (s === 'available' && !simulated) || settings.cloudConsent;
  bannerWhy.textContent = BANNER_WHY[simulated ? 'simulated' : s] || BANNER_WHY.unavailable;
  bannerData.textContent = briefingIsOwn()
    ? 'Your briefing is not sent: it is no longer Sam\'s sample. You can choose to send excerpts in the Live tab.'
    : "Sam's briefing is fictional, so this demo also sends the matching excerpts, until you change the briefing; in the extension that is a separate opt-in.";
}
// Sam's briefing is fictional, so the demo also shares its excerpts with the
// cloud; otherwise a judge without Gemini Nano never sees grounded replies.
// Never the user's own text: see stopAutoShare().
document.getElementById('try-cloud').addEventListener('click', () => {
  const auto = !briefingIsOwn();
  applyPatch({ cloudConsent: true, shareBriefingWithCloud: auto, demoAutoShare: auto });
});
updateBanner();

// ---- simulated captions; one request at a time, as in the extension ----
const captions = document.getElementById('captions');
const history = [];
let step = 0;
let timer = null;
let requestId = 0;

const runner = new SuggestionRunner({
  getEngine: () => engineReady,
  peekEngine: () => engine,
  onPartial: (job, replies) => job.id === requestId && overlay.setPartial(replies),
  onResult: (job, res) => {
    if (job.id !== requestId) return; // a newer line arrived meanwhile
    overlay.setSuggestions(res.replies, res.route, job.lines.at(-1)?.text);
    scheduleAutoNext();
    if (res.route === 'blocked') {
      overlay.notice(
        settings.cloudConsent
          ? 'On-device AI is not available here and the cloud is switched off for now: these are basic replies.'
          : 'On-device AI is not available here. Use "Try with the cloud" above to continue.'
      );
    }
    // The cloud refused or could not answer: say so, long enough to be read.
    if (res.cloudProblem) overlay.notice(CLOUD_PROBLEM_TEXT[res.cloudProblem], 12000);
    if (res.error) console.warn('[Pipe Up]', res.error);
  },
  onLog: (res) => controls.reportRun(res),
});
// Simulates Meet's pause detection, with the same early start on the device.
const pause = createPauseTimer({
  onEarly: () => runner.speculate(history.slice(-3)),
  onChange: () => runner.cancelEarly(),
  onPause: () => ask(history.slice(-3)),
});

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
    pause.stop();
    if (!overlay.isEngaged()) overlay.clear(); // the old suggestions answered an older question
    scheduleAutoNext();
    return overlay.notice('Press Alt+S (or the button) when you want suggestions.');
  }
  pause.set({ pauseMs: engine?.remote.pause_ms, earlyMs: engine?.remote.speculate_ms });
  pause.touch();
}

function ask(lines) {
  const id = ++requestId;
  overlay.setThinking(lines.at(-1)?.text);
  runner.request({ id, lines });
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
    if (overlay.isEngaged() || runner.busy) return scheduleAutoNext(2000);
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
  await briefingStore.set(SAMPLE_BRIEFING); // no prepared answers: the sample as it is
  location.reload();
});

// Step 2 of the demo: opens "Prepare for the call" in the Briefing tab. The
// confirmation that sends the briefing to the cloud stays there, in full.
document.getElementById('prep').addEventListener('click', () => {
  if (!controls.showPrepare()) overlay.notice("Load Sam's sample briefing first (step 1), or save your own in the Briefing tab.");
});

const engineReady = initFirebase({
  firebaseConfig: __FIREBASE_CONFIG__,
  // reCAPTCHA is loaded, and a token asked for, at the first cloud request
  // only: a visit that stays on the device never contacts it.
  appCheck: __RECAPTCHA_SITE_KEY__ ? { provider: lazyAppCheckProvider(() => new ReCaptchaEnterpriseProvider(__RECAPTCHA_SITE_KEY__)) } : {},
}).then((firebase) => {
  engine = new SuggestionEngine({
    firebase,
    memory,
    getBriefing: () => briefingIndex,
    getSettings: () => settings,
  });
  engine.warmUp();
  updateBanner();
  return engine;
});
