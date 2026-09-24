(function() {
    console.log("Igensia Enhancer: EDT content script loaded.");

    // Load search.js and search.css
    function loadSearchFeatures() {
        console.log("EDT content script: Loading search features.");
        const head = document.getElementsByTagName('head')[0];

        const searchCss = document.createElement('link');
        searchCss.rel = 'stylesheet';
        searchCss.type = 'text/css';
        searchCss.href = chrome.runtime.getURL('search.css');
        head.appendChild(searchCss);
        console.log("EDT content script: search.css added.");

        const searchJs = document.createElement('script');
        searchJs.type = 'text/javascript';
        searchJs.src = chrome.runtime.getURL('search.js');
        head.appendChild(searchJs);
        console.log("EDT content script: search.js added.");
    }

    loadSearchFeatures();

    // Réception des cours envoyés par search.js (contexte page) et mise en cache
    // pour le « prochain cours » du popup et la liste des matières des devoirs.
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'igs-edt-sync') return;
        const incoming = Array.isArray(event.data.events) ? event.data.events : [];
        if (!incoming.length) return;
        // La fusion avec le cache est faite par le background (storeEdtEvents),
        // qui gère aussi la synchro réseau de l'EDT.
        try {
            chrome.runtime.sendMessage({ action: 'edt_store_events', events: incoming, url: window.location.href }, () => {
                void chrome.runtime.lastError; // extension rechargée : on ignore
            });
        } catch (e) {
            console.warn('Igensia Enhancer: impossible de transmettre l\'EDT', e);
        }
    });
})();
