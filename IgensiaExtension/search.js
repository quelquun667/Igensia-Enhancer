(function() {
    let searchBarAdded = false;

    function addSearchBar() {
        if (searchBarAdded) return;

        console.log("search.js: Attempting to add search bar.");
        const schedulerToolbar = document.querySelector('.k-scheduler-toolbar');
        if (schedulerToolbar) {
            console.log("search.js: Scheduler toolbar found, adding search bar.");
            const searchBarContainer = document.createElement('div');
            searchBarContainer.className = 'search-bar-container';
            if (document.body.classList.contains('dark-mode')) {
                searchBarContainer.classList.add('dark-mode');
            }

            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Rechercher un cours...';
            searchInput.className = 'search-input';
            if (document.body.classList.contains('dark-mode')) {
                searchInput.classList.add('dark-mode');
            }

            searchBarContainer.appendChild(searchInput);
            
            // Insérer la barre de recherche après le bouton de date et avant le k-spacer
            const dateButton = schedulerToolbar.querySelector('.k-nav-current');
            const spacer = schedulerToolbar.querySelector('.k-spacer');

            if (dateButton && spacer) {
                dateButton.insertAdjacentElement('afterend', searchBarContainer);
            } else {
                // Fallback si les éléments spécifiques ne sont pas trouvés
                schedulerToolbar.prepend(searchBarContainer);
            }
            searchBarAdded = true;

            function performSearch() {
                const searchTerm = searchInput.value.toLowerCase();
                const scheduler = $("#scheduler").data("kendoScheduler");

                if (!scheduler) {
                    console.error("search.js: Kendo Scheduler instance not found.");
                    return;
                }

                const dataSource = scheduler.dataSource;

                if (searchTerm.length > 0) {
                    dataSource.filter({
                        logic: "or",
                        filters: [
                            { field: "Commentaire", operator: "contains", value: searchTerm },
                            { field: "Matiere", operator: "contains", value: searchTerm },
                            { field: "NomProf", operator: "contains", value: searchTerm },
                            { field: "Salles", operator: "contains", value: searchTerm }
                        ]
                    });
                    console.log(`search.js: Applied filter for: ${searchTerm}`);
                } else {
                    dataSource.filter({}); // Clear all filters
                    console.log("search.js: Cleared all filters.");
                }
            }

            searchInput.addEventListener('input', performSearch);

            // Re-apply dark mode class if body changes
            const observer = new MutationObserver(() => {
                if (document.body.classList.contains('dark-mode')) {
                    searchBarContainer.classList.add('dark-mode');
                    searchInput.classList.add('dark-mode');
                } else {
                    searchBarContainer.classList.remove('dark-mode');
                    searchInput.classList.remove('dark-mode');
                }
            });
            observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        } else {
            console.log("search.js: Scheduler toolbar not found yet.");
        }
    }

    // -------------------------
    // Synchronisation de l'EDT vers l'extension (prochain cours dans le popup)
    // search.js tourne dans le contexte de la page : il a accès à l'instance Kendo,
    // il transmet les cours chargés à edt_content.js via window.postMessage.
    // -------------------------
    let edtSyncBound = false;

    function toIso(d) {
        const date = d instanceof Date ? d : new Date(d);
        return isNaN(date) ? null : date.toISOString();
    }

    function sendEdtEvents(scheduler) {
        // Mêmes noms de champs que l'API /Home/Get : normalizeEdtEvent (background.js) fait le reste
        const events = scheduler.dataSource.data().map(ev => ({
            start: toIso(ev.start),
            end: toIso(ev.end),
            title: ev.title || ev.Title || '',
            Matiere: ev.Matiere || '',
            NomProf: ev.NomProf || '',
            Salles: ev.Salles || '',
            Commentaire: ev.Commentaire || '',
            LienTrack: ev.LienTrack || '',
            TeamsUrl: ev.TeamsUrl || ''
        })).filter(ev => ev.start && ev.end);
        window.postMessage({ source: 'igs-edt-sync', events }, window.location.origin);
    }

    function bindEdtSync() {
        if (edtSyncBound || typeof $ === 'undefined') return;
        const scheduler = $("#scheduler").data("kendoScheduler");
        if (!scheduler) return;
        edtSyncBound = true;
        // Chaque navigation (semaine suivante, etc.) recharge la dataSource
        scheduler.dataSource.bind('change', () => sendEdtEvents(scheduler));
        sendEdtEvents(scheduler);
    }

    const edtSyncObserver = new MutationObserver(() => {
        bindEdtSync();
        if (edtSyncBound) edtSyncObserver.disconnect();
    });
    edtSyncObserver.observe(document.body, { childList: true, subtree: true });
    bindEdtSync();

    // Use a MutationObserver to wait for the scheduler toolbar to be available
    const observer = new MutationObserver((mutationsList, observer) => {
        console.log("search.js: MutationObserver triggered.");
        if (document.querySelector('.k-scheduler-toolbar')) {
            console.log("search.js: Scheduler toolbar detected by observer.");
            addSearchBar();
            // Disconnect the observer once the search bar is added
            if (searchBarAdded) {
                observer.disconnect();
            }
        }
    });

    // Start observing the document body for child list changes
    observer.observe(document.body, { childList: true, subtree: true });

    // Also try to add it immediately in case the toolbar is already there
    addSearchBar();
})();
