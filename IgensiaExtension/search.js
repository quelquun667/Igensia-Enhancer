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
            setupGlobalSearch(searchInput);

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

    // -------------------------
    // Recherche dans tout l'emploi du temps (pas seulement la semaine affichée).
    // Les cours sont chargés via la même API que le planning (/Home/Get), par
    // tranches de 30 jours, une seule fois par page. Un clic sur un résultat
    // affiche la semaine du cours.
    // -------------------------
    const GLOBAL_SEARCH_PAST_DAYS = 60;
    const GLOBAL_SEARCH_FUTURE_DAYS = 240;
    const GLOBAL_SEARCH_CHUNK_DAYS = 30;
    const MAX_UPCOMING_RESULTS = 40;
    let allCoursesPromise = null;

    function normalizeText(text) {
        return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    // /Home/Get renvoie l'heure locale déguisée en UTC (« 10:30+02:00 » pour 8h30) :
    // les heures UTC de la date sont l'heure réelle du cours (voir parseEdtDate dans background.js)
    function wallClock(value) {
        const aspNet = String(value || '').match(/\/Date\((-?\d+)/);
        const d = aspNet ? new Date(parseInt(aspNet[1], 10)) : new Date(value);
        if (isNaN(d)) return null;
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
    }

    async function fetchCourses(start, end) {
        const url = `/Home/Get?sort=&group=&filter=&dateDebut=${encodeURIComponent(start.toISOString())}&dateFin=${encodeURIComponent(end.toISOString())}`;
        const resp = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
        const json = await resp.json();
        return Array.isArray(json) ? json : (json && (json.Data || json.data)) || [];
    }

    function loadAllCourses() {
        if (allCoursesPromise) return allCoursesPromise;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const requests = [];
        for (let offset = -GLOBAL_SEARCH_PAST_DAYS; offset < GLOBAL_SEARCH_FUTURE_DAYS; offset += GLOBAL_SEARCH_CHUNK_DAYS) {
            const start = new Date(today);
            start.setDate(start.getDate() + offset);
            const end = new Date(start);
            end.setDate(end.getDate() + GLOBAL_SEARCH_CHUNK_DAYS);
            requests.push(fetchCourses(start, end).catch(() => []));
        }
        allCoursesPromise = Promise.all(requests).then(parts => {
            const seen = new Set();
            const courses = [];
            parts.flat().forEach(item => {
                const start = wallClock(item.Start);
                const end = wallClock(item.End);
                if (!start || !end) return;
                const key = item.NoCours != null ? item.NoCours : `${item.Start}|${item.Title}`;
                if (seen.has(key)) return;
                seen.add(key);
                const name = String(item.Commentaire || '').replace(/\s+/g, ' ').trim() ||
                    String(item.Title || '').replace(/^G\d+\s+/i, '');
                courses.push({
                    start,
                    end,
                    name,
                    subject: String(item.Title || '').replace(/^G\d+\s+/i, ''),
                    prof: String(item.NomProf || '').trim(),
                    salle: String(item.Salles || '').trim(),
                    haystack: normalizeText([item.Commentaire, item.Title, item.NomProf, item.Salles].join(' '))
                });
            });
            return courses.sort((a, b) => a.start - b.start);
        });
        // En cas d'échec, permettre un nouvel essai à la prochaine recherche
        allCoursesPromise.catch(() => { allCoursesPromise = null; });
        return allCoursesPromise;
    }

    function formatDay(date) {
        const label = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
        return label.charAt(0).toUpperCase() + label.slice(1);
    }

    function formatHour(date) {
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    // « CEZERA STÉPHANE » → « Cezera Stéphane » ; « B110-S(Bâtiment B) » → « B110-S · Bâtiment B »
    function formatProf(prof) {
        return prof.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, letter) => sep + letter.toUpperCase());
    }

    function formatSalle(salle) {
        if (/DISTANCIEL/i.test(salle)) return 'Distanciel';
        const match = salle.match(/^(.*?)\s*\((.*)\)\s*$/);
        return match ? `${match[1]} · ${match[2]}` : salle;
    }

    function goToDate(date) {
        const scheduler = typeof $ !== 'undefined' && $('#scheduler').data('kendoScheduler');
        // Midi : évite de basculer sur la veille avec le fuseau Etc/UTC du planning
        if (scheduler) scheduler.date(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12));
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function setupGlobalSearch(input) {
        const panel = el('div', 'igs-search-panel');
        panel.hidden = true;
        panel.setAttribute('role', 'listbox');
        document.body.appendChild(panel);

        const syncTheme = () => panel.classList.toggle('dark-mode', document.body.classList.contains('dark-mode'));

        function place() {
            const r = input.getBoundingClientRect();
            panel.style.top = `${r.bottom + window.scrollY + 6}px`;
            panel.style.left = `${Math.max(8, r.left + window.scrollX)}px`;
            panel.style.width = `${Math.max(360, r.width)}px`;
        }

        function close() {
            panel.hidden = true;
        }

        function resultButton(course, isNext, isPast) {
            const btn = el('button', `igs-search-result${isPast ? ' is-past' : ''}`);
            btn.type = 'button';
            const head = el('div', 'igs-search-result-head');
            head.append(el('span', 'igs-search-result-day', formatDay(course.start)));
            head.append(el('span', 'igs-search-result-time', `${formatHour(course.start)} – ${formatHour(course.end)}`));
            if (isNext) head.append(el('span', 'igs-search-result-next', 'Prochain'));
            btn.append(head, el('div', 'igs-search-result-name', course.name));
            const meta = [course.salle && formatSalle(course.salle), course.prof && formatProf(course.prof)].filter(Boolean).join('  ·  ');
            if (meta) btn.append(el('div', 'igs-search-result-meta', meta));
            btn.addEventListener('click', () => {
                goToDate(course.start);
                close();
            });
            return btn;
        }

        async function render() {
            const query = normalizeText(input.value.trim());
            if (query.length < 2) {
                close();
                return;
            }
            syncTheme();
            place();
            panel.hidden = false;
            panel.replaceChildren(el('div', 'igs-search-status', "Recherche dans tout l'emploi du temps…"));

            let courses;
            try {
                courses = await loadAllCourses();
            } catch {
                panel.replaceChildren(el('div', 'igs-search-status', "Impossible de charger l'emploi du temps."));
                return;
            }
            if (normalizeText(input.value.trim()) !== query) return; // l'utilisateur a continué à taper

            const terms = query.split(/\s+/);
            const matches = courses.filter(c => terms.every(t => c.haystack.includes(t)));
            const now = new Date();
            const upcoming = matches.filter(c => c.end > now);
            const past = matches.filter(c => c.end <= now).reverse();

            panel.replaceChildren();
            if (!matches.length) {
                panel.append(el('div', 'igs-search-status', 'Aucun cours trouvé.'));
                return;
            }
            panel.append(el('div', 'igs-search-summary',
                `${upcoming.length} cours à venir${past.length ? ` · ${past.length} passé${past.length > 1 ? 's' : ''}` : ''}`));
            upcoming.slice(0, MAX_UPCOMING_RESULTS).forEach((c, i) => panel.append(resultButton(c, i === 0, false)));
            if (upcoming.length > MAX_UPCOMING_RESULTS) {
                panel.append(el('div', 'igs-search-status', `… et ${upcoming.length - MAX_UPCOMING_RESULTS} autres`));
            }
            if (past.length) {
                const toggle = el('button', 'igs-search-toggle', `Voir les cours passés (${past.length})`);
                toggle.type = 'button';
                toggle.addEventListener('click', () => {
                    toggle.remove();
                    past.forEach(c => panel.append(resultButton(c, false, true)));
                });
                panel.append(toggle);
            }
        }

        let debounce = null;
        input.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(render, 200);
        });
        input.addEventListener('focus', () => {
            loadAllCourses().catch(() => { }); // préchargement
            if (input.value.trim().length >= 2) render();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'Enter') {
                const first = panel.querySelector('.igs-search-result');
                if (first && !panel.hidden) first.click();
            }
        });
        document.addEventListener('mousedown', (e) => {
            if (!panel.hidden && !panel.contains(e.target) && e.target !== input) close();
        });
        window.addEventListener('resize', () => { if (!panel.hidden) place(); });
    }

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
