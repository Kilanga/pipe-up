// Opens the side panel (where the AI engine runs) from the toolbar icon or
// from the ⚙ button in the in-call panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // A voice is included, so Meet tabs can mix it into the microphone from the
  // start (voice-flag.js), without a reload after the side panel first opens.
  // The side panel turns this off if the voice cannot start.
  chrome.storage.local.set({ voiceInstalled: true });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'pu:open-panel' && sender.tab?.id != null) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
});
