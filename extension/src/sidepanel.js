// The side panel hosts the AI engine: Chrome's Prompt API (Gemini Nano) is
// available in extension pages, and Firebase AI Logic runs here. It serves
// exactly one Meet tab, the active one in its window, through a named port,
// so two windows never answer the same question twice.
import { initFirebase, SuggestionEngine } from '../../core/engine.js';
import { IdbMemoryStore, makeEvent } from '../../core/memory.js';
import { DEFAULT_SETTINGS, migrateSettings } from '../../core/config.js';
import { SuggestionRunner } from '../../core/runner.js';
import { mountControls } from '../../shared/controls.js';
import { setPdfWorker } from '../../shared/extract.js';
import { speakPrivately } from '../../shared/private-speech.js';
import { isVoiceDownloaded, setupVoice, startVoice, synthesize } from './voice.js';

/* global __FIREBASE_CONFIG__ */
const firebaseConfig = __FIREBASE_CONFIG__;
const MEET = /^https:\/\/meet\.google\.com\//;

setPdfWorker(chrome.runtime.getURL('pdf.worker.min.mjs'));

const memory = new IdbMemoryStore('pipe-up');
let settings = { ...DEFAULT_SETTINGS };
let briefingIndex = null;
let engine = null;
let enginePromise = null;

// The App Check debug token lives only in this extension page's own storage:
// content scripts on meet.google.com cannot read it.
const TOKEN_KEY = 'pu-appcheck-debug-token';
const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  },
  set: (v) => {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked: token kept for this session only */
    }
  },
};

const settingsStore = {
  async get() {
    const { settings: s } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(s || {}) };
  },
  async set(patch) {
    const s = await this.get();
    await chrome.storage.local.set({ settings: { ...s, ...patch } });
  },
};
const briefingStore = {
  async get() {
    return (await chrome.storage.local.get('briefing')).briefing || {};
  },
  async set(b) {
    await chrome.storage.local.set({ briefing: b });
  },
};

const controls = mountControls(document.getElementById('app'), {
  getEngine: () => engine,
  memory,
  settings: settingsStore,
  briefing: briefingStore,
  onBriefing: (idx) => (briefingIndex = idx),
  voice: {
    status: async () => (voiceReady ? 'ready' : voiceFailed ? 'failed' : (await isVoiceDownloaded()) ? 'loading' : 'missing'),
    setup: async (onProgress) => {
      voiceFailed = false;
      try {
        await setupVoice(onProgress);
        setVoiceReady(true);
      } catch (e) {
        voiceFailed = true;
        throw e;
      }
    },
    test: async () => {
      const { pcm16, rate } = await synthesize('Hi, this is my Pipe Up voice.');
      playLocally(pcm16, rate);
    },
  },
  debugToken: {
    get: tokenStore.get,
    set: (v) => {
      tokenStore.set(v);
      location.reload(); // App Check cannot be re-initialized in a running Firebase app
    },
  },
});

function startEngine() {
  enginePromise ??= (async () => {
    const debugToken = tokenStore.get();
    const firebase = await initFirebase({ firebaseConfig, appCheck: debugToken ? { debugToken } : {} });
    engine = new SuggestionEngine({ firebase, memory, getBriefing: () => briefingIndex, getSettings: () => settings });
    engine.warmUp();
    return engine;
  })();
  return enginePromise;
}

async function loadSettings() {
  const { settings: saved } = await chrome.storage.local.get('settings');
  const s = migrateSettings(saved || {});
  // Older versions kept the debug token with the settings: move it.
  if (s.appCheckDebugToken) {
    if (!tokenStore.get()) tokenStore.set(s.appCheckDebugToken);
    delete s.appCheckDebugToken;
  }
  await chrome.storage.local.set({ settings: s });
  settings = s;
}
loadSettings().then(startEngine);
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  controls.applySettings(settings);
});

// ---------- Local voice ----------
let voiceReady = false;
let voiceFailed = false;
function setVoiceReady(on) {
  voiceReady = on;
  // Tells Meet tabs opened from now on to mix the voice into the microphone.
  chrome.storage.local.set({ voiceInstalled: on });
  if (port) safePost(port, { type: 'voice', ready: on });
  controls.refreshVoice();
}
isVoiceDownloaded().then(async (has) => {
  if (!has) return;
  try {
    await startVoice();
    setVoiceReady(true);
  } catch (e) {
    console.warn('[Pipe Up] voice could not start', e);
    voiceFailed = true;
    chrome.storage.local.set({ voiceInstalled: false });
    controls.refreshVoice();
  }
});
let localCtx = null;
let localSrc = null;
function playLocally(pcm16, rate) {
  const bin = atob(pcm16);
  localCtx ??= new AudioContext();
  const ctx = localCtx;
  try {
    localSrc?.stop(); // a newer preview replaces the one playing
  } catch {}
  const n = bin.length / 2;
  const buf = ctx.createBuffer(1, n, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16) >> 16) / 0x7fff;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  localSrc = src;
}

// "Hear the suggestions": local Piper voice if set up, otherwise a local
// system voice. Plays on this computer only, never into the call.
let previewSeq = 0;
async function preview(text) {
  const seq = ++previewSeq;
  if (voiceReady) {
    try {
      const { pcm16, rate } = await synthesize(text);
      if (seq === previewSeq) playLocally(pcm16, rate);
      return;
    } catch (e) {
      console.warn('[Pipe Up] preview voice failed', e);
    }
  }
  speakPrivately(text);
}

// ---------- Connection to the Meet tab ----------
let port = null;
let portTabId = null;

// One request at a time, the newest question wins and the one it replaces
// is cancelled; see core/runner.js.
const runner = new SuggestionRunner({
  getEngine: () => startEngine(),
  peekEngine: () => engine,
  onPartial: (job, replies) => safePost(job.port, { type: 'partial', id: job.id, replies }),
  onResult: (job, res) => safePost(job.port, { type: 'result', id: job.id, ...res }),
  onLog: (res) => controls.reportRun(res),
});

async function connectActiveTab() {
  const win = await chrome.windows.getCurrent();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab || !MEET.test(tab.url || '')) {
    // Keep serving the Meet tab we are connected to, if any.
    controls.setConnection(!!port);
    return;
  }
  if (port && portTabId === tab.id) return controls.setConnection(true);
  port?.disconnect();
  const p = chrome.tabs.connect(tab.id, { name: 'pipe-up' });
  port = p;
  portTabId = tab.id;
  p.onMessage.addListener((msg) => onTabMessage(p, msg));
  p.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // the content script may not be loaded yet
    if (port !== p) return;
    port = null;
    portTabId = null;
    runner.abort(); // nobody is waiting for the answer any more
    controls.setConnection(false);
    setTimeout(connectActiveTab, 1500);
  });
  p.postMessage({ type: 'voice', ready: voiceReady });
  // Pause lengths come from Remote Config, which the engine has loaded.
  startEngine().then(
    (eng) => safePost(p, { type: 'timing', pauseMs: Number(eng.remote.pause_ms) || 1200, earlyMs: Number(eng.remote.speculate_ms) || 0 }),
    () => {}
  );
  controls.setConnection(true);
}

async function onTabMessage(p, msg) {
  if (msg?.type === 'suggest') {
    runner.request({ id: msg.id, lines: msg.lines, port: p });
  } else if (msg?.type === 'speculate') {
    runner.speculate(msg.lines);
  } else if (msg?.type === 'unspeculate') {
    runner.cancelEarly();
  } else if (msg?.type === 'speak') {
    try {
      safePost(p, { type: 'audio', ...(await synthesize(msg.text)) });
    } catch (e) {
      console.warn('[Pipe Up] voice failed', e);
      safePost(p, { type: 'speak-failed' });
    }
  } else if (msg?.type === 'preview') {
    preview(msg.text);
  } else if (msg?.type === 'event') {
    // "Don't learn" means the moment is not recorded at all.
    if (!settings.dontLearn) memory.add(makeEvent(msg.event)).then(() => controls.renderMemory());
  }
}

function safePost(p, msg) {
  try {
    p.postMessage(msg);
  } catch {
    /* the tab went away */
  }
}

chrome.tabs.onActivated.addListener(() => connectActiveTab());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete' || info.url) connectActiveTab();
});
connectActiveTab();
