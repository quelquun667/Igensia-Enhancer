document.addEventListener('DOMContentLoaded', () => {
    const showDevoirsBtn = document.getElementById('show-devoirs-btn');
    const homeView = document.getElementById('home-view');
    const devoirsIframe = document.getElementById('devoirs-iframe');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const themeButtons = document.querySelectorAll('.theme-btn');
    const body = document.body;

    // Fonction pour appliquer le thème
    function applyTheme(theme) {
        body.className = ''; // Réinitialiser toutes les classes de thème
        if (theme !== 'default') {
            body.classList.add(`theme-${theme}`);
        }

        // Mettre à jour l'état actif des boutons de thème
        themeButtons.forEach(btn => {
            if (btn.dataset.theme === theme) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Envoyer le thème à l'iframe des devoirs
        if (devoirsIframe.contentWindow) {
            devoirsIframe.contentWindow.postMessage({ type: 'apply-theme', theme: theme }, '*');
        }
    }

    // Charger le thème sauvegardé
    chrome.storage.sync.get('selectedTheme', (data) => {
        const savedTheme = data.selectedTheme || 'default';
        applyTheme(savedTheme);
    });

    if (showDevoirsBtn && homeView && devoirsIframe) {
        showDevoirsBtn.addEventListener('click', () => {
            homeView.style.display = 'none';
            devoirsIframe.style.display = 'block';
            // Appliquer le thème actuel à l'iframe lors de son affichage
            chrome.storage.sync.get('selectedTheme', (data) => {
                const currentTheme = data.selectedTheme || 'default';
                applyTheme(currentTheme); // Ceci enverra le message à l'iframe
            });
        });
    }

    // Récupérer la version du manifest et l'afficher
    const versionDisplay = document.getElementById('version-display');
    if (versionDisplay) {
        const manifest = chrome.runtime.getManifest();
        versionDisplay.textContent = `v${manifest.version}`;
    }

    const backToHomeBtn = document.getElementById('back-to-home-btn');

    // Logique pour ouvrir/fermer le panneau de paramètres
    if (settingsBtn && settingsPanel && closeSettingsBtn && backToHomeBtn) {
        settingsBtn.addEventListener('click', () => {
            homeView.style.display = 'none';
            devoirsIframe.style.display = 'none';
            settingsPanel.classList.add('active');
        });

        closeSettingsBtn.addEventListener('click', () => {
            settingsPanel.classList.remove('active');
            homeView.style.display = 'flex'; // Revenir à la vue d'accueil
        });

        backToHomeBtn.addEventListener('click', () => {
            settingsPanel.classList.remove('active');
            homeView.style.display = 'flex'; // Revenir à la vue d'accueil
        });
    }

    // Logique pour changer de thème
    themeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const selectedTheme = button.dataset.theme;
            applyTheme(selectedTheme);
            chrome.storage.sync.set({ selectedTheme: selectedTheme });
        });
    });
});
