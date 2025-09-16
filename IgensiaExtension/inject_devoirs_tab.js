(function() {
    console.log("Igensia Enhancer: inject_devoirs_tab.js loaded.");

    function injectDevoirsTab() {
        const navbarRightActions = document.querySelector('.navbar-nav.navbar-right-actions');
        const globalSearchContainer = document.querySelector('.global-search');

        if (navbarRightActions && globalSearchContainer) {
            // Créer l'élément de l'onglet "Mes Devoirs"
            const devoirsNavItem = document.createElement('li');
            devoirsNavItem.className = 'nav-item';
            devoirsNavItem.style.cursor = 'pointer'; // Indiquer que c'est cliquable

            const devoirsLink = document.createElement('a');
            devoirsLink.className = 'nav-link';
            devoirsLink.title = 'Mes Devoirs';
            devoirsLink.innerHTML = '<i class="fas fa-clipboard-list"></i> Mes Devoirs'; // Icône et texte

            devoirsNavItem.appendChild(devoirsLink);

            // Insérer l'onglet avant la barre de recherche globale
            navbarRightActions.insertBefore(devoirsNavItem, globalSearchContainer);

            // Ajouter un écouteur d'événements pour ouvrir la popup
            devoirsNavItem.addEventListener('click', () => {
                // Envoyer un message au service worker pour ouvrir la popup
                chrome.runtime.sendMessage({ action: "openDevoirsPopup" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Igensia Enhancer: Erreur lors de l'ouverture de la popup. Le service worker est peut-être inactif. Veuillez cliquer sur l'icône de l'extension dans la barre d'outils du navigateur.");
                        // Optionnel: afficher une alerte temporaire à l'utilisateur
                        // alert("La popup n'a pas pu s'ouvrir. Veuillez cliquer sur l'icône de l'extension.");
                    }
                });
            });

            console.log("Igensia Enhancer: 'Mes Devoirs' tab injected.");
        } else {
            console.log("Igensia Enhancer: Could not find navbar elements to inject 'Mes Devoirs' tab.");
        }
    }

    // Exécuter l'injection après un court délai pour s'assurer que le DOM est prêt
    // Ou utiliser un MutationObserver si l'élément n'est pas toujours présent au document_idle
    setTimeout(injectDevoirsTab, 1000); // Attendre 1 seconde

    // Écouter les messages de la popup pour des actions futures si nécessaire
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "refreshDevoirs") {
            // Si la popup envoie un message pour rafraîchir, on pourrait par exemple
            // mettre à jour un badge sur l'icône de l'extension ou l'onglet injecté
            console.log("Igensia Enhancer: Refresh devoirs requested from popup.");
        }
    });
})();
