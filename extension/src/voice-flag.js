// Isolated world, document_start: tells voice-main.js (Meet's page) whether to
// mix the Pipe Up voice into the microphone. Only when a voice is ready and
// the user chose a voice output: with "Chat only", Meet gets the plain
// microphone, untouched. Both are read from storage, so this is right when
// the side panel is closed, and it follows every change.
const update = () =>
  chrome.storage.local.get(['voiceInstalled', 'settings']).then(({ voiceInstalled, settings }) => {
    const voiceChosen = Boolean(settings?.outputMode) && settings.outputMode !== 'chat';
    document.documentElement.dataset.pipeUpVoice = voiceInstalled && voiceChosen ? 'on' : 'off';
  });
update();
chrome.storage.onChanged.addListener((c) => (c.voiceInstalled || c.settings) && update());
