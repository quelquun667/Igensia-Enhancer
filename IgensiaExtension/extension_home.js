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
        // Remove existing theme classes, then add explicit theme class
        body.classList.remove('theme-dark', 'theme-light');
        if (theme === 'default' || theme === 'light') {
            body.classList.add('theme-light');
        } else if (theme === 'dark') {
            body.classList.add('theme-dark');
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

    // Safe sendMessage helper for popup (checks lastError)
    function popupSendMessage(message, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            let finished = false;
            try {
                chrome.runtime.sendMessage(message, resp => {
                    finished = true;
                    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                    resolve(resp);
                });
            } catch (e) { return reject(e); }
            setTimeout(() => { if (!finished) reject(new Error('No response from runtime')); }, timeoutMs);
        });
    }

    // Update UI: banner
    const checkUpdateBtn = document.getElementById('check-update-btn');
    const updateBanner = document.getElementById('update-banner');
    const updateBannerText = document.getElementById('update-banner-text');
    const updateOpenBtn = document.getElementById('update-open-btn');
    const updateDismissBtn = document.getElementById('update-dismiss-btn');

    async function showUpdateIfAny(result) {
        if (!result || !result.ok) return;
        if (result.updated) {
            updateBannerText.textContent = `Nouvelle version disponible : ${result.remoteVersion} (locale ${result.localVersion})`;
            updateBanner.style.display = 'block';
        } else {
            // optionally show a brief confirmation
            updateBannerText.textContent = `Aucune mise à jour (v${result.localVersion})`;
            updateOpenBtn.style.display = 'none';
            setTimeout(() => { updateBanner.style.display = 'none'; updateOpenBtn.style.display = ''; }, 2000);
        }
    }

    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', async () => {
            checkUpdateBtn.disabled = true;
            try {
                const resp = await popupSendMessage({ action: 'run_check_remote_manifest' }, 8000);
                console.log('Popup got checkRemoteManifest response', resp);
                await showUpdateIfAny(resp);
            } catch (err) {
                console.error('Error asking background for update check', err);
            } finally {
                checkUpdateBtn.disabled = false;
            }
        });
    }

    if (updateOpenBtn) {
        updateOpenBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: 'https://github.com/quelquun667/Igensia-Extension' });
        });
    }
    if (updateDismissBtn) {
        updateDismissBtn.addEventListener('click', () => {
            updateBanner.style.display = 'none';
        });
    }

    // Logique pour ouvrir/fermer le panneau de paramètres
    if (settingsBtn && settingsPanel && closeSettingsBtn) {
        settingsBtn.addEventListener('click', () => {
            homeView.style.display = 'none';
            devoirsIframe.style.display = 'none';
            settingsPanel.classList.add('active');
        });

        closeSettingsBtn.addEventListener('click', () => {
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
