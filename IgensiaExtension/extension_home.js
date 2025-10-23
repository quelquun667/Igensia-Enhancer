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
    const settingsBadge = document.getElementById('settings-badge');
    const settingsCheckUpdateBtn = document.getElementById('settings-check-update-btn');
    const settingsUpdateActions = document.getElementById('settings-update-actions');
    const settingsUpdateText = document.getElementById('settings-update-text');
    const settingsSeeUpdateBtn = document.getElementById('settings-see-update-btn');
    const settingsDismissUpdateBtn = document.getElementById('settings-dismiss-update-btn');

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

    // settings panel check button
    if (settingsCheckUpdateBtn) {
        settingsCheckUpdateBtn.addEventListener('click', async () => {
            settingsCheckUpdateBtn.disabled = true;
            try {
                const resp = await popupSendMessage({ action: 'run_check_remote_manifest' }, 8000);
                console.log('Settings got checkRemoteManifest response', resp);
                if (resp && resp.ok && resp.updated) {
                    if (settingsBadge) settingsBadge.style.display = 'flex';
                    // show actions in settings panel
                    if (settingsUpdateActions) settingsUpdateActions.style.display = 'block';
                    if (settingsUpdateText) settingsUpdateText.textContent = `Nouvelle version disponible : ${resp.remoteVersion} (locale ${resp.localVersion})`;
                    settingsCheckUpdateBtn.style.display = 'none';
                } else {
                    // show a short confirmation inside settings
                    if (settingsUpdateActions) {
                        settingsUpdateText.textContent = `Aucune mise à jour (v${resp && resp.localVersion ? resp.localVersion : chrome.runtime.getManifest().version})`;
                        settingsUpdateActions.style.display = 'block';
                        // Hide actions buttons for this case
                        if (settingsSeeUpdateBtn) settingsSeeUpdateBtn.style.display = 'none';
                        if (settingsDismissUpdateBtn) settingsDismissUpdateBtn.style.display = 'none';
                        setTimeout(() => {
                            if (settingsUpdateActions) settingsUpdateActions.style.display = 'none';
                            if (settingsSeeUpdateBtn) settingsSeeUpdateBtn.style.display = '';
                            if (settingsDismissUpdateBtn) settingsDismissUpdateBtn.style.display = '';
                        }, 1500);
                    }
                }
            } catch (err) {
                console.error('Error asking background for update check', err);
            } finally {
                settingsCheckUpdateBtn.disabled = false;
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
            // When opening settings, if a flag is set, display actions as if we pressed the check.
            popupSendMessage({ action: 'get_update_flag' }).then(resp => {
                if (resp && resp.ok && resp.value) {
                    // We can run the check to get version info and show actions
                    return popupSendMessage({ action: 'run_check_remote_manifest' }, 8000).then(r => {
                        if (r && r.ok && r.updated) {
                            if (settingsBadge) settingsBadge.style.display = 'flex';
                            if (settingsUpdateActions) settingsUpdateActions.style.display = 'block';
                            if (settingsUpdateText) settingsUpdateText.textContent = `Nouvelle version disponible : ${r.remoteVersion} (locale ${r.localVersion})`;
                            if (settingsCheckUpdateBtn) settingsCheckUpdateBtn.style.display = 'none';
                        }
                    });
                }
            }).catch(() => {});
        });

        closeSettingsBtn.addEventListener('click', () => {
            settingsPanel.classList.remove('active');
            homeView.style.display = 'flex'; // Revenir à la vue d'accueil
        });
    }

    // Settings actions: see/dismiss
    if (settingsSeeUpdateBtn) {
        settingsSeeUpdateBtn.addEventListener('click', async () => {
            try {
                await popupSendMessage({ action: 'clear_update_flag' });
                if (settingsBadge) settingsBadge.style.display = 'none';
            } catch(e) {}
            chrome.tabs.create({ url: 'https://github.com/quelquun667/Igensia-Extension' });
        });
    }
    if (settingsDismissUpdateBtn) {
        settingsDismissUpdateBtn.addEventListener('click', async () => {
            try {
                await popupSendMessage({ action: 'clear_update_flag' });
                if (settingsBadge) settingsBadge.style.display = 'none';
            } catch(e) {}
            if (settingsUpdateActions) settingsUpdateActions.style.display = 'none';
            if (settingsCheckUpdateBtn) settingsCheckUpdateBtn.style.display = '';
        });
    }

    // On popup load, check if background reported an update and show badge
    (async () => {
        try {
            const resp = await popupSendMessage({ action: 'get_update_flag' });
            if (resp && resp.ok && resp.value) {
                if (settingsBadge) settingsBadge.style.display = 'flex';
            }
        } catch(e) { }
    })();

    // Logique pour changer de thème
    themeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const selectedTheme = button.dataset.theme;
            applyTheme(selectedTheme);
            chrome.storage.sync.set({ selectedTheme: selectedTheme });
        });
    });
});
