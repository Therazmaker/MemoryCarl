const STORAGE_KEY = "patternlabCapturedCandles";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (!Array.isArray(result[STORAGE_KEY])) {
      chrome.storage.local.set({ [STORAGE_KEY]: [] });
    }
  });
});
