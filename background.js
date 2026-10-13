chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    const results = await chrome.scripting.executeScript({
      target: {tabId: tab.id}, files: ["keys.js"]
    });
    const enabled = results[0]?.result === true;
    await chrome.action.setBadgeText({tabId: tab.id, text: enabled ? "ON" : ""});
    await chrome.action.setBadgeBackgroundColor({tabId: tab.id, color: "#176b46"});
    await chrome.action.setTitle({tabId: tab.id,
      title: enabled ? "Emacs keys enabled — click to disable" : "Enable Emacs keys"});
  } catch (error) {
    await chrome.action.setBadgeText({tabId: tab.id, text: "!"});
    await chrome.action.setTitle({tabId: tab.id,
      title: "Open an ordinary web page to use Browsered. " + error.message});
  }
});
