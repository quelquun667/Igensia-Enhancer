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
})();
