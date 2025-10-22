chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "openDevoirsPopup") {
        chrome.action.openPopup();
        return; // no async response needed
    }

    // Provide a fetch-from-background fallback so content scripts can delegate
    // cross-origin requests (useful when the page-level fetch fails due to CORS/network issues).
    if (request.action === 'fetchUrl' && request.url) {
        (async () => {
            try {
                const resp = await fetch(request.url, { credentials: 'include' });
                const text = await resp.text();
                sendResponse({ ok: true, status: resp.status, text });
            } catch (err) {
                sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
            }
        })();
        // Indicate we'll send response asynchronously
        return true;
    }
});
