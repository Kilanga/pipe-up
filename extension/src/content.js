import { createOverlay } from '../../shared/overlay.js';
import { watchCaptions, setMyName } from './meet-captions.js';
import { sendToMeetChat } from './meet-chat.js';
import { raiseHand } from './meet-hand.js';
import { DEFAULT_SETTINGS, REMOTE_DEFAULTS } from '../../core/config.js';

let settings = { ...DEFAULT_SETTINGS };
let port = null; // to the side panel, which runs the AI
let requestId = 0;
let voiceReady = false;
const contexts = new Map(); // request id -> the line it answers
const unsent = []; // learning events kept while the side panel is closed

const overlay = createOverlay({
  onSend: async ({ text, action, choice, shown, context }) => {
    log({ action, reply: text, choice, shown, context });
    // Optional: "I'm still speaking" (the first quick phrase) also raises the hand.
    if (action === 'filler' && settings.raiseHandOnHold && text === settings.fillers?.[0]) raiseHand();
    await deliver(text);
  },
  onSpoke: ({ shown, context }) => log({ action: 'spoke', reply: '', shown, context }),
  onDismiss: ({ shown, context }) => log({ action: 'dismissed', reply: '', shown, context }),
  onSettings: (patch) => saveSettings(patch),
  onRequest: () => {
    const lines = watcher.current();
    if (lines.length) request(lines);
    else overlay.notice('Nothing in the captions yet.');
  },
  onOpenPanel: () => chrome.runtime.sendMessage({ type: 'pu:open-panel' }),
  // Read in the side panel, on this computer only (never into the call).
  onHear: (text) => port?.postMessage({ type: 'preview', text }),
});

chrome.storage.local.get('settings').then(({ settings: s }) => applySettings(s));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) applySettings(changes.settings.newValue);
});

function applySettings(s) {
  settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  setMyName(settings.myName);
  overlay.setSettings(settings);
}

async function saveSettings(patch) {
  const { settings: s } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...(s || {}), ...patch } });
}

// ---------- Side panel connection ----------
chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'pipe-up') return;
  if (port && port !== p) port.disconnect();
  port = p;
  p.onMessage.addListener(onPanelMessage);
  p.onDisconnect.addListener(() => {
    if (port !== p) return;
    port = null;
    // A question sent to the closed panel will not be answered.
    if (overlay.isThinking()) {
      overlay.clear();
      overlay.notice('The Pipe Up side panel closed. Open it to get suggestions again.');
    }
  });
  while (unsent.length) p.postMessage({ type: 'event', event: unsent.shift() });
});

function log(event) {
  if (port) port.postMessage({ type: 'event', event });
  else if (unsent.length < 50) unsent.push(event);
}

function onPanelMessage(msg) {
  if (msg.type === 'voice') {
    voiceReady = Boolean(msg.ready);
    overlay.setVoiceAvailable(voiceReady);
    return;
  }
  if (msg.type === 'timing') return watcher.setTiming(msg);
  if (msg.type === 'audio') return playInCall(msg);
  if (msg.type === 'speak-failed') {
    const text = lastSpoken;
    lastSpoken = null;
    if (settings.outputMode === 'voice' && text) return fallbackToChat(text, 'The voice could not read this reply.');
    return overlay.notice('The voice could not read this reply.');
  }
  if (msg.id !== requestId) return; // an answer to an older question
  if (msg.type === 'partial') overlay.setPartial(msg.replies);
  if (msg.type === 'result') {
    overlay.setSuggestions(msg.replies, msg.route, contexts.get(msg.id));
    if (msg.route === 'blocked') overlay.notice('On-device AI is not ready. Open the side panel (⚙) to set it up or allow the cloud.');
  }
}

function request(lines) {
  if (!port) {
    if (!overlay.isEngaged()) overlay.clear(); // older suggestions do not answer this question
    overlay.notice('Open the Pipe Up side panel (⚙) to get suggestions.');
    return;
  }
  const id = ++requestId;
  const context = lines.at(-1)?.text || '';
  contexts.set(id, context);
  contexts.delete(id - 20);
  overlay.setThinking(context);
  port.postMessage({ type: 'suggest', id, lines });
}

// ---------- Output ----------
let lastSpoken = null; // the reply being spoken, until the page reports back
async function deliver(text) {
  const wantsVoice = settings.outputMode !== 'chat';
  const canSpeak = wantsVoice && voiceReady && port;
  if (canSpeak) {
    lastSpoken = text;
    port.postMessage({ type: 'speak', text });
  }
  if (settings.outputMode === 'voice' && canSpeak) return;
  const r = await sendToMeetChat(text);
  if (!r.ok) {
    overlay.notice(r.copied ? 'Could not post in the chat: your reply is in the clipboard.' : 'Could not post in the chat. Please type it there.');
  } else if (wantsVoice && !canSpeak) {
    overlay.notice('The voice is not set up yet (side panel, Live tab): your reply went to the chat.');
  }
}

// The side panel synthesizes the voice; the page script mixes it into the
// microphone that Meet uses (voice-main.js).
function playInCall({ pcm16, rate }) {
  const bin = atob(pcm16);
  const i16 = new Int16Array(bin.length / 2);
  for (let i = 0; i < i16.length; i++) i16[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16;
  const pcm = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) pcm[i] = i16[i] / 0x7fff;
  window.postMessage({ type: 'pipe-up:pcm', pcm, rate }, location.origin);
}
const VOICE_PROBLEMS = {
  muted: 'You are muted in Meet: unmute so others can hear the voice.',
  'needs-click': 'Click once in the Meet window so the browser allows sound, then try again.',
  reload: 'The voice was set up after you joined: reload this Meet tab to use it.',
  'no-mic': 'Join the call with your microphone on, then Pipe Up can speak for you.',
};
window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin || e.data?.type !== 'pipe-up:pcm-status') return;
  const text = lastSpoken;
  lastSpoken = null;
  if (e.data.ok) return;
  // "Voice only" must not lose the reply: post it in the chat instead.
  if (settings.outputMode === 'voice' && text) fallbackToChat(text, VOICE_PROBLEMS[e.data.reason] || VOICE_PROBLEMS['no-mic']);
  else overlay.notice(VOICE_PROBLEMS[e.data.reason] || VOICE_PROBLEMS['no-mic']);
});
async function fallbackToChat(text, why) {
  const r = await sendToMeetChat(text);
  overlay.notice(why + (r.ok ? ' Your reply went to the chat.' : ' Your reply is not sent: please type it.'));
}

// ---------- Captions ----------
let early = false; // the side panel was told to start early on the current captions
const watcher = watchCaptions({
  pauseMs: REMOTE_DEFAULTS.pause_ms,
  earlyMs: 0, // off until the side panel sends the timing (it decides if Gemini Nano can start early)
  onLine: (speaker, text) => overlay.setLine(speaker, text),
  onMissing: () => overlay.notice('Turn on captions in Meet (CC button) so Pipe Up can follow the conversation.'),
  // A short silence: the side panel may start generating on the device.
  // Nothing is shown before the normal pause.
  onEarly: (lines) => {
    if (!port || settings.suggestMode === 'onDemand') return;
    early = true;
    port.postMessage({ type: 'speculate', lines });
  },
  onChange: () => {
    if (early) port?.postMessage({ type: 'unspeculate' });
    early = false;
  },
  onPause: (lines) => {
    early = false;
    if (settings.suggestMode === 'onDemand') {
      // Waits for Alt+S; suggestions for an older question are withdrawn.
      if (!overlay.isEngaged()) overlay.clear();
      return;
    }
    request(lines);
  },
});
