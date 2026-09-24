// Popup : navigation entre vues, thème, cours (EDT), dernières notes, temps passé, mises à jour.
// La vue « Mes devoirs » est gérée par devoirs.js.
document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    const backBtn = document.getElementById('back-btn');
    const appLogo = document.getElementById('app-logo');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsBadge = document.getElementById('settings-badge');
    const viewTitle = document.getElementById('view-title');
    const viewSubtitle = document.getElementById('view-subtitle');
    const themeSegments = document.querySelectorAll('.segment[data-theme]');

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

    function openTab(url) {
        chrome.tabs.create({ url });
    }

    // ============ Navigation ============
    const VIEWS = {
        home: { el: document.getElementById('view-home'), title: 'Igensia Enhancer' },
        devoirs: { el: document.getElementById('view-devoirs'), title: 'Mes devoirs' },
        settings: { el: document.getElementById('view-settings'), title: 'Paramètres' }
    };
    const homeSubtitle = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    function showView(name) {
        Object.entries(VIEWS).forEach(([key, view]) => { view.el.hidden = key !== name; });
        const isHome = name === 'home';
        backBtn.hidden = isHome;
        appLogo.hidden = !isHome;
        settingsBtn.hidden = name === 'settings';
        viewTitle.textContent = VIEWS[name].title;
        viewSubtitle.textContent = isHome ? homeSubtitle.charAt(0).toUpperCase() + homeSubtitle.slice(1) : '';
        document.querySelector('main').scrollTop = 0;
    }

    backBtn.addEventListener('click', () => showView('home'));
    settingsBtn.addEventListener('click', () => showView('settings'));
    document.getElementById('devoirs-shortcut').addEventListener('click', () => showView('devoirs'));
    showView('home');

    // ============ Thème ============
    // selectedTheme (chrome.storage.sync) : 'default' (clair) | 'dark' | 'system'
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
    let currentTheme = 'default';

    function applyTheme(theme) {
        currentTheme = theme;
        const dark = theme === 'dark' || (theme === 'system' && systemDark.matches);
        root.dataset.theme = dark ? 'dark' : 'light';
        themeSegments.forEach(btn => btn.setAttribute('aria-checked', String(btn.dataset.theme === theme)));
    }

    chrome.storage.sync.get('selectedTheme', (data) => applyTheme(data.selectedTheme || 'default'));
    systemDark.addEventListener('change', () => { if (currentTheme === 'system') applyTheme('system'); });
    themeSegments.forEach(btn => {
        btn.addEventListener('click', () => {
            applyTheme(btn.dataset.theme);
            chrome.storage.sync.set({ selectedTheme: btn.dataset.theme });
        });
    });

    // ============ Mises à jour ============
    const checkUpdateBtn = document.getElementById('settings-check-update-btn');
    const updateStatus = document.getElementById('update-status');
    const updateStatusText = document.getElementById('update-status-text');
    const updateActions = document.getElementById('update-actions');
    const REPO_URL = 'https://github.com/quelquun667/Igensia-Enhancer';

    document.getElementById('version-display').textContent = `v${chrome.runtime.getManifest().version}`;

    function showUpdateResult(result) {
        updateStatus.hidden = false;
        const available = !!(result && result.ok && result.updated);
        updateStatus.classList.toggle('is-available', available);
        updateActions.hidden = !available;
        settingsBadge.hidden = !available;
        if (available) {
            updateStatusText.textContent = `Nouvelle version disponible : v${result.remoteVersion}`;
        } else if (result && result.ok) {
            updateStatusText.textContent = 'Tu as la dernière version.';
        } else {
            updateStatusText.textContent = 'Impossible de vérifier pour le moment.';
        }
    }

    checkUpdateBtn.addEventListener('click', async () => {
        checkUpdateBtn.disabled = true;
        try {
            showUpdateResult(await popupSendMessage({ action: 'run_check_remote_manifest' }, 8000));
        } catch (err) {
            showUpdateResult(null);
        } finally {
            checkUpdateBtn.disabled = false;
        }
    });

    document.getElementById('settings-see-update-btn').addEventListener('click', async () => {
        try { await popupSendMessage({ action: 'clear_update_flag' }); } catch (e) { }
        settingsBadge.hidden = true;
        openTab(REPO_URL);
    });

    document.getElementById('settings-dismiss-update-btn').addEventListener('click', async () => {
        try { await popupSendMessage({ action: 'clear_update_flag' }); } catch (e) { }
        settingsBadge.hidden = true;
        updateStatus.hidden = true;
    });

    // À l'ouverture : si le background a signalé une mise à jour, re-vérifier
    // (auto-nettoie un badge obsolète) et préparer le panneau des paramètres
    (async () => {
        try {
            const flag = await popupSendMessage({ action: 'get_update_flag' });
            if (!flag || !flag.ok || !flag.value) return;
            settingsBadge.hidden = false;
            const result = await popupSendMessage({ action: 'run_check_remote_manifest' }, 8000);
            if (result && result.ok && result.updated) showUpdateResult(result);
            else settingsBadge.hidden = true;
        } catch (e) { }
    })();

    // ============ Temps passé ============
    // Clé YYYY-MM-DD en heure locale (même format que getTodayKey dans background.js)
    function localDateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function formatTime(secs) {
        const hours = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        return `${hours}h ${mins}m`;
    }

    (async () => {
        try {
            const resp = await popupSendMessage({ action: 'get_time_stats' });
            if (!resp || !resp.ok || !resp.stats) return;
            const stats = resp.stats;
            const monday = new Date();
            const dayOfWeek = monday.getDay();
            monday.setDate(monday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
            const weekStart = localDateKey(monday);

            let weekSeconds = 0;
            let totalSeconds = 0;
            Object.entries(stats).forEach(([date, secs]) => {
                totalSeconds += secs;
                if (date >= weekStart) weekSeconds += secs;
            });
            document.getElementById('time-today').textContent = formatTime(stats[localDateKey(new Date())] || 0);
            document.getElementById('time-week').textContent = formatTime(weekSeconds);
            document.getElementById('time-total').textContent = formatTime(totalSeconds);
        } catch (e) {
            console.warn('Error fetching time stats:', e);
        }
    })();

    // ============ Helpers d'affichage ============
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function emptyState(container, text) {
        const div = el('div', 'empty-state');
        div.innerHTML = iconSvg('inbox');
        div.append(text);
        container.appendChild(div);
    }

    function formatSyncAge(timestamp) {
        if (!timestamp) return '';
        const mins = Math.floor((Date.now() - timestamp) / 60000);
        if (mins < 1) return "Mis à jour à l'instant";
        if (mins < 60) return `Mis à jour il y a ${mins} min`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `Mis à jour il y a ${hours} h`;
        return `Mis à jour il y a ${Math.floor(hours / 24)} j`;
    }

    function setFootnote(node, text, isError) {
        node.textContent = text;
        node.classList.toggle('is-error', !!isError);
    }

    // ============ Cours (EDT) ============
    const coursesBody = document.getElementById('courses-body');
    const coursesSync = document.getElementById('courses-sync');
    let edtUrl = null;

    document.getElementById('edt-open').addEventListener('click', (e) => {
        e.preventDefault();
        openTab(edtUrl || 'https://moncampus.igensia-education.fr/');
    });

    function formatHour(date) {
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    function formatCourseDay(date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const day = new Date(date);
        day.setHours(0, 0, 0, 0);
        const diffDays = Math.round((day - today) / 86400000);
        if (diffDays === 0) return "Aujourd'hui";
        if (diffDays === 1) return 'Demain';
        const label = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
        return label.charAt(0).toUpperCase() + label.slice(1);
    }

    function formatDuration(ms) {
        const mins = Math.round(ms / 60000);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
    }

    // L'API EDT renvoie Matiere = "COMMENTAIRE" (valeur sans intérêt)
    function isPlaceholderMatiere(text) {
        return String(text || '').toUpperCase() === 'COMMENTAIRE';
    }

    function courseName(ev) {
        return ev.libelle || (!isPlaceholderMatiere(ev.matiere) && ev.matiere) || ev.title || 'Cours';
    }

    // « B110-S(Bâtiment B) » → « B110-S · Bâtiment B »
    function formatSalle(salle) {
        const match = salle.match(/^(.*?)\s*\((.*)\)\s*$/);
        return match ? `${match[1]} · ${match[2]}` : salle;
    }

    // « CEZERA STÉPHANE » → « Cezera Stéphane »
    function formatProf(prof) {
        return prof.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, letter) => sep + letter.toUpperCase());
    }

    function infoRow(icon, text, extra) {
        const row = el('div', 'info-row');
        row.innerHTML = iconSvg(icon);
        row.appendChild(el('span', null, text));
        if (extra) row.appendChild(el('span', 'info-extra', extra));
        return row;
    }

    function renderCourse(ev, live) {
        const start = new Date(ev.start);
        const end = new Date(ev.end);
        const block = el('div', live ? 'course is-live' : 'course');

        const head = el('div', 'course-head');
        const tag = el('span', 'course-tag');
        if (live) tag.appendChild(el('span', 'live-dot'));
        tag.append(live ? 'En cours' : 'Prochain cours');
        head.append(tag, el('span', 'course-when', live
            ? `Fin à ${formatHour(end)}`
            : `${formatCourseDay(start)} · ${formatHour(start)}`));
        block.appendChild(head);

        const name = courseName(ev);
        block.appendChild(el('p', 'course-name', name));
        // Nom officiel de la matière en sous-titre s'il diffère du libellé de l'EDT
        if (ev.matiere && ev.matiere !== name && !isPlaceholderMatiere(ev.matiere)) {
            block.appendChild(el('p', 'course-subject', ev.matiere));
        }

        const info = el('div', 'course-info');
        info.appendChild(infoRow('clock', `${formatHour(start)} – ${formatHour(end)}`, formatDuration(end - start)));
        if (ev.distanciel) info.appendChild(infoRow('monitor', 'Distanciel'));
        else if (ev.salle) info.appendChild(infoRow('map-pin', formatSalle(ev.salle)));
        if (ev.prof) info.appendChild(infoRow('user', formatProf(ev.prof)));
        block.appendChild(info);

        if (live) {
            const progress = el('div', 'progress');
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-label', 'Avancement du cours');
            const pct = Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100));
            progress.setAttribute('aria-valuenow', String(Math.round(pct)));
            const bar = el('span');
            bar.style.width = `${pct}%`;
            progress.appendChild(bar);
            block.appendChild(progress);
        }
        return block;
    }

    function renderCourses(events, syncedAt, error) {
        coursesBody.innerHTML = '';
        if (error === 'session') setFootnote(coursesSync, "Session EDT expirée : ouvre l'EDT une fois pour la renouveler.", true);
        else if (error === 'format') setFootnote(coursesSync, 'Synchronisation EDT impossible (format inconnu).', true);
        else setFootnote(coursesSync, formatSyncAge(syncedAt));

        if (!events.length && !syncedAt) {
            emptyState(coursesBody, "Ouvre ton emploi du temps une fois pour synchroniser tes cours.");
            return;
        }

        const now = Date.now();
        const current = events.find(ev => Date.parse(ev.start) <= now && Date.parse(ev.end) > now);
        // Prochain cours : le suivant, même s'il est demain ou après le week-end
        const upcoming = events.find(ev => Date.parse(ev.start) > now);

        if (current) coursesBody.appendChild(renderCourse(current, true));
        if (upcoming) coursesBody.appendChild(renderCourse(upcoming, false));
        if (!current && !upcoming) emptyState(coursesBody, 'Aucun cours prévu dans les deux prochaines semaines.');
    }

    function loadCourses() {
        chrome.storage.local.get(['igs_edt_events', 'igs_edt_synced_at', 'igs_edt_url', 'igs_edt_sync_error'], (res) => {
            edtUrl = res.igs_edt_url || null;
            const events = (res.igs_edt_events || []).slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
            renderCourses(events, res.igs_edt_synced_at, res.igs_edt_sync_error);
        });
    }

    // Afficher le cache tout de suite, puis synchroniser en arrière-plan
    loadCourses();
    popupSendMessage({ action: 'sync_edt' }, 10000).then(loadCourses).catch(() => { });

    // ============ Dernières notes ============
    const gradesBody = document.getElementById('grades-body');
    const gradesSync = document.getElementById('grades-sync');
    const LATEST_GRADES_COUNT = 5;
    const newGradeKeys = new Set(); // gardées pour tout l'affichage du popup, même après mark_grades_seen
    let notesUrl = null;

    document.getElementById('grades-open').addEventListener('click', (e) => {
        e.preventDefault();
        openTab(notesUrl || 'https://ws-notes-igs.wigorservices.net/Home/');
    });

    function gradeKey(g) {
        return `${g.name}|${g.epreuve}|${g.date}|${g.grade}`;
    }

    // « 25/11/2025 » → timestamp
    function parseFrDate(text) {
        const m = String(text || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0;
    }

    function renderGrades(grades, syncedAt, error) {
        gradesBody.innerHTML = '';
        if (error === 'session') setFootnote(gradesSync, 'Session expirée : ouvre ton relevé une fois pour la renouveler.', true);
        else setFootnote(gradesSync, formatSyncAge(syncedAt));

        if (!grades.length) {
            emptyState(gradesBody, syncedAt ? 'Aucune note pour le moment.' : 'Ouvre ton relevé de notes une fois pour synchroniser.');
            return;
        }

        // Les notes apparues le plus récemment d'abord, puis par date d'épreuve
        const sorted = grades.slice().sort((a, b) =>
            (b.firstSeen || 0) - (a.firstSeen || 0) || parseFrDate(b.date) - parseFrDate(a.date));

        const list = el('ul', 'grade-list');
        sorted.slice(0, LATEST_GRADES_COUNT).forEach(g => {
            const row = el('li', 'grade-row');
            row.appendChild(el('span', `grade-pill grade-${g.grade.charAt(0).toLowerCase()}`, g.grade));

            const text = el('div', 'grade-text');
            const moduleName = el('div', 'grade-module', g.name.replace(/^[A-Z0-9]+\s*-\s*/, '')); // retire le code module
            moduleName.title = g.name;
            text.append(moduleName, el('div', 'grade-detail', [g.epreuve, g.date].filter(Boolean).join(' · ')));
            row.appendChild(text);

            if (newGradeKeys.has(gradeKey(g))) row.appendChild(el('span', 'new-tag', 'Nouveau'));
            list.appendChild(row);
        });
        gradesBody.appendChild(list);
    }

    function loadGrades() {
        chrome.storage.local.get(['igs_latest_grades', 'igs_grades_synced_at', 'igs_grades_sync_error', 'igs_notes_url', 'igs_new_grades'], (res) => {
            notesUrl = res.igs_notes_url || null;
            const pending = res.igs_new_grades || [];
            pending.forEach(g => newGradeKeys.add(gradeKey(g)));
            renderGrades(res.igs_latest_grades || [], res.igs_grades_synced_at, res.igs_grades_sync_error);
            // Les nouvelles notes sont maintenant vues : retirer le badge de l'icône
            if (pending.length) popupSendMessage({ action: 'mark_grades_seen' }).catch(() => { });
        });
    }

    loadGrades();
    popupSendMessage({ action: 'sync_grades' }, 15000).then(loadGrades).catch(() => { });
});
