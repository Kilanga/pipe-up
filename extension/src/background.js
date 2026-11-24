// Opens the side panel (where the AI engine runs) from the toolbar icon or
// from the ⚙ button in the in-call panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'pu:open-panel' && sender.tab?.id != null) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
});
