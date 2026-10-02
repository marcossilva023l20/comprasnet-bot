// Service Worker - handles messages between popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "open_tab") {
    chrome.tabs.create({ url: msg.url }, (tab) => {
      sendResponse({ tabId: tab.id });
    });
    return true;
  }
});
