chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "openDevoirsPopup") {
        chrome.action.openPopup();
    }
});
