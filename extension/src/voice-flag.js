// Isolated world, document_start: tells voice-main.js (Meet's page) whether
// the Pipe Up voice is set up, so the microphone is only mixed when needed.
const flag = (on) => (document.documentElement.dataset.pipeUpVoice = on ? 'on' : 'off');
chrome.storage.local.get('voiceInstalled').then(({ voiceInstalled }) => flag(voiceInstalled));
chrome.storage.onChanged.addListener((c) => c.voiceInstalled && flag(c.voiceInstalled.newValue));
