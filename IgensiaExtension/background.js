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
    // Allow popup to request a remote manifest check now
    if (request.action === 'run_check_remote_manifest') {
        (async () => {
            const res = await checkRemoteManifest();
            sendResponse(res);
        })();
        return true; // will respond asynchronously
    }
    if (request.action === 'clear_update_flag') {
        chrome.storage.local.set({ igs_update_available: false }, () => sendResponse({ ok: true }));
        return true;
    }
    if (request.action === 'get_update_flag') {
        chrome.storage.local.get(['igs_update_available'], res => sendResponse({ ok: true, value: !!res.igs_update_available }));
        return true;
    }
    // Time tracking: get stats
    if (request.action === 'get_time_stats') {
        // Enregistrer d'abord le temps en cours pour que le popup soit à jour
        queueTrackingRefresh().then(() => {
            chrome.storage.local.get(['igs_time_stats'], res => {
                sendResponse({ ok: true, stats: res.igs_time_stats || {} });
            });
        });
        return true;
    }
    // Notes : synchronisation demandée par le popup
    if (request.action === 'sync_grades') {
        syncGrades({ force: !!request.force }).then(sendResponse);
        return true;
    }
    // Notes : le popup a affiché les nouvelles notes, on retire le badge
    if (request.action === 'mark_grades_seen') {
        chrome.action.setBadgeText({ text: '' });
        chrome.storage.local.set({ igs_new_grades: [] }, () => sendResponse({ ok: true }));
        return true;
    }
    // EDT : cours lus sur la page par search.js / edt_content.js (mêmes champs que l'API)
    if (request.action === 'edt_store_events' && Array.isArray(request.events)) {
        const events = request.events.map(item => normalizeEdtEvent(item)).filter(Boolean);
        const starts = events.map(ev => Date.parse(ev.start));
        if (!starts.length) return;
        const rangeStart = new Date(Math.min(...starts));
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(Math.max(...starts));
        rangeEnd.setHours(23, 59, 59, 999);
        const extra = { igs_edt_sync_error: null };
        if (request.url) extra.igs_edt_url = request.url;
        queueEdtStore(events, rangeStart, rangeEnd, extra).then(() => sendResponse({ ok: true }));
        return true;
    }
    // EDT : synchronisation demandée par le popup
    if (request.action === 'sync_edt') {
        syncEdt({ force: !!request.force }).then(sendResponse);
        return true;
    }
});

// -------------------------
// EDT (emploi du temps)
// -------------------------
// L'EDT Wigor charge ses cours via GET /Home/Get?dateDebut=ISO&dateFin=ISO.
// La requête n'a besoin que du cookie de session de ws-edt-igs, créé quand
// l'utilisateur ouvre l'EDT depuis MonCampus. Si la session a expiré, la
// réponse n'est plus du JSON : on garde le cache et on le signale au popup.
const EDT_API_URL = 'https://ws-edt-igs.wigorservices.net/Home/Get';
const EDT_SYNC_DAYS = 14;
const EDT_MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000;

// v2 : correction du décalage de fuseau de l'API (voir parseEdtDate) — invalide l'ancien cache
const EDT_CACHE_VERSION = 2;

// Dates au format ASP.NET « /Date(1727676000000)/ » ou ISO.
// utcWallClock : l'API /Home/Get renvoie l'heure locale déguisée en UTC puis
// décalée (« 10:30:00+02:00 » pour un cours à 8h30) ; la page EDT l'affiche
// correctement car le planning Kendo est configuré en Etc/UTC. On fait pareil :
// les heures/minutes UTC de la date sont l'heure locale réelle du cours.
function parseEdtDate(value, { utcWallClock = false } = {}) {
    if (value == null || value === '') return null;
    let date;
    if (value instanceof Date) date = value;
    else if (typeof value === 'number') date = new Date(value);
    else {
        const aspNet = String(value).match(/\/Date\((-?\d+)/);
        date = aspNet ? new Date(parseInt(aspNet[1], 10)) : new Date(value);
    }
    if (isNaN(date)) return null;
    if (!utcWallClock) return date;
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
        date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
}

function pickField(item, names) {
    for (const name of names) {
        if (item[name] != null && item[name] !== '') return item[name];
    }
    return null;
}

// Format d'un cours renvoyé par /Home/Get :
// { Title: "G1 Administration des BDD", Commentaire: "Administration BDD: SQL Server",
//   Matiere: "COMMENTAIRE" (inutilisable), NomProf, Salles, Start/End ISO avec fuseau, ... }
// fromApi : dates brutes de l'API (à corriger) ; sinon dates déjà converties par le planning Kendo (search.js)
function normalizeEdtEvent(item, { fromApi = false } = {}) {
    if (!item) return null;
    const start = parseEdtDate(pickField(item, ['Start', 'start', 'DateDebut', 'dateDebut']), { utcWallClock: fromApi });
    const end = parseEdtDate(pickField(item, ['End', 'end', 'DateFin', 'dateFin']), { utcWallClock: fromApi });
    if (!start || !end) return null;
    const title = String(pickField(item, ['Title', 'title']) || '').trim();
    const rawMatiere = String(pickField(item, ['Matiere', 'matiere']) || '').trim();
    // Nom de la matière : Title sans le préfixe de groupe (« G1 »), Matiere ne sert que s'il est renseigné
    const matiere = (rawMatiere && rawMatiere.toUpperCase() !== 'COMMENTAIRE')
        ? rawMatiere
        : title.replace(/^G\d+\s+/i, '');
    return {
        start: start.toISOString(),
        end: end.toISOString(),
        title,
        matiere,
        // Libellé court affiché dans l'EDT (« Unix/Linux Server: avancé »)
        libelle: String(pickField(item, ['Commentaire', 'commentaire']) || '').replace(/\s+/g, ' ').trim(),
        prof: String(pickField(item, ['NomProf', 'nomProf']) || '').trim(),
        salle: String(pickField(item, ['Salles', 'salles']) || '').trim(),
        distanciel: /DISTANCIEL/i.test(String(item.Salles || item.salles || '')),
        lien: String(item.LienTrack || item.TeamsUrl || '')
    };
}

// Fusionne les cours reçus dans le cache : ils remplacent ceux déjà connus sur
// [rangeStart, rangeEnd] (gère les cours déplacés/annulés). Alimente aussi la
// liste des matières utilisée par « Mes Devoirs ».
async function storeEdtEvents(incoming, rangeStart, rangeEnd, extra = {}) {
    const res = await chrome.storage.local.get(['igs_edt_events', 'igs_subjects']);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const kept = (res.igs_edt_events || []).filter(ev => {
        const s = Date.parse(ev.start);
        return (s < rangeStart.getTime() || s > rangeEnd.getTime()) && Date.parse(ev.end) > cutoff;
    });
    const events = kept.concat(incoming.filter(ev => Date.parse(ev.end) > cutoff))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    const subjects = res.igs_subjects || [];
    const known = new Set(subjects.map(s => s.toLowerCase()));
    incoming.forEach(ev => {
        const name = (ev.matiere || '').trim();
        if (name && !known.has(name.toLowerCase())) {
            known.add(name.toLowerCase());
            subjects.push(name);
        }
    });
    subjects.sort((a, b) => a.localeCompare(b, 'fr'));

    await chrome.storage.local.set({ igs_edt_events: events, igs_edt_synced_at: Date.now(), igs_subjects: subjects, ...extra });
}

// Page EDT et synchro réseau peuvent écrire en même temps : on sérialise
let edtStoreQueue = Promise.resolve();
function queueEdtStore(...args) {
    edtStoreQueue = edtStoreQueue.then(() => storeEdtEvents(...args)).catch(err => console.warn('EDT store error:', err));
    return edtStoreQueue;
}

async function syncEdt({ force = false } = {}) {
    try {
        const stored = await chrome.storage.local.get(['igs_edt_synced_at', 'igs_edt_cache_version']);
        if (stored.igs_edt_cache_version !== EDT_CACHE_VERSION) {
            // Cache écrit avec les anciennes heures décalées : on repart de zéro
            await chrome.storage.local.set({ igs_edt_events: [], igs_edt_cache_version: EDT_CACHE_VERSION });
            force = true;
        }
        if (!force && stored.igs_edt_synced_at && Date.now() - stored.igs_edt_synced_at < EDT_MIN_SYNC_INTERVAL_MS) {
            return { ok: true, skipped: true };
        }

        const rangeStart = new Date();
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeEnd.getDate() + EDT_SYNC_DAYS);

        const url = `${EDT_API_URL}?sort=&group=&filter=&dateDebut=${encodeURIComponent(rangeStart.toISOString())}&dateFin=${encodeURIComponent(rangeEnd.toISOString())}`;
        const resp = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        });

        let json = null;
        try { json = resp.ok ? await resp.json() : null; } catch { json = null; }
        const list = Array.isArray(json) ? json : (json && (json.Data || json.data));
        if (!Array.isArray(list)) {
            // Redirection vers une page de connexion, session expirée, etc.
            await chrome.storage.local.set({ igs_edt_sync_error: 'session' });
            return { ok: false, reason: 'session', status: resp.status };
        }

        const events = list.map(item => normalizeEdtEvent(item, { fromApi: true })).filter(Boolean);
        if (list.length && !events.length) {
            console.warn('EDT sync: format de réponse inconnu', list[0]);
            await chrome.storage.local.set({ igs_edt_sync_error: 'format' });
            return { ok: false, reason: 'format' };
        }

        rangeEnd.setMilliseconds(-1);
        await queueEdtStore(events, rangeStart, rangeEnd, { igs_edt_sync_error: null });
        return { ok: true, count: events.length };
    } catch (err) {
        console.warn('EDT sync failed:', err);
        return { ok: false, reason: 'exception', error: String(err) };
    }
}

// -------------------------
// Time Tracking System
// -------------------------
// Le service worker MV3 est arrêté après ~30 s d'inactivité : l'heure de début
// est donc gardée dans chrome.storage.session (pas en mémoire), et une alarme
// enregistre le temps chaque minute.
const MONCAMPUS_DOMAINS = ['moncampus.igensia-education.fr', 'ws-notes-igs.wigorservices.net', 'ws-edt-igs.wigorservices.net', 'eabsences-igs.wigorservices.net'];
const TRACK_START_KEY = 'igs_track_start';
// Au-delà, le temps écoulé depuis le dernier enregistrement est suspect (veille du PC, navigateur planté)
const MAX_TRACK_CHUNK_SECONDS = 5 * 60;

function isMonCampusUrl(url) {
    try {
        const hostname = new URL(url).hostname;
        return MONCAMPUS_DOMAINS.some(d => hostname.includes(d));
    } catch { return false; }
}

// Clé du jour en heure locale (toISOString découperait les jours en UTC)
function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function saveTimeSpent(seconds) {
    if (seconds < 1) return;
    const key = getTodayKey();
    const stored = await chrome.storage.local.get(['igs_time_stats']);
    const stats = stored.igs_time_stats || {};
    stats[key] = (stats[key] || 0) + seconds;
    await chrome.storage.local.set({ igs_time_stats: stats });
}

async function isMonCampusFocused() {
    try {
        const win = await chrome.windows.getLastFocused();
        if (!win || !win.focused) return false;
        const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
        return !!(tab && tab.url && isMonCampusUrl(tab.url));
    } catch { return false; }
}

// Enregistre le temps écoulé puis démarre/arrête le chrono selon l'onglet actif
async function refreshTracking() {
    const stored = await chrome.storage.session.get([TRACK_START_KEY]);
    const start = stored[TRACK_START_KEY] || null;
    const onMonCampus = await isMonCampusFocused();
    if (start) {
        const elapsed = Math.min(Math.floor((Date.now() - start) / 1000), MAX_TRACK_CHUNK_SECONDS);
        await saveTimeSpent(elapsed);
    }
    await chrome.storage.session.set({ [TRACK_START_KEY]: onMonCampus ? Date.now() : null });
}

// Les événements peuvent arriver en rafale : on les traite un par un
let trackingQueue = Promise.resolve();
function queueTrackingRefresh() {
    trackingQueue = trackingQueue.then(refreshTracking).catch(err => console.warn('Time tracking error:', err));
    return trackingQueue;
}

chrome.tabs.onActivated.addListener(() => queueTrackingRefresh());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) queueTrackingRefresh();
});
chrome.tabs.onRemoved.addListener(() => queueTrackingRefresh());
chrome.windows.onFocusChanged.addListener(() => queueTrackingRefresh());

// -------------------------
// GitHub update checker
// -------------------------
const GITHUB_API_RELEASES = 'https://api.github.com/repos/quelquun667/Igensia-Extension/releases/latest';
const STORAGE_KEY = 'igs_last_release';

// Correct raw URL for the manifest inside the repository path as provided by the user
const RAW_MANIFEST_URL = 'https://raw.githubusercontent.com/quelquun667/Igensia-Extension/refs/heads/main/IgensiaExtension/manifest.json';
const STORAGE_MANIFEST_KEY = 'igs_remote_manifest_version';

async function checkForGithubRelease() {
    try {
        const stored = await new Promise(resolve => chrome.storage.local.get([STORAGE_KEY, STORAGE_KEY + '_etag'], res => resolve(res)));
        const lastSeen = stored[STORAGE_KEY] || null;
        const etag = stored[STORAGE_KEY + '_etag'] || null;

        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (etag) headers['If-None-Match'] = etag;

        const resp = await fetch(GITHUB_API_RELEASES, { headers });
        if (resp.status === 304) {
            // Not modified
            return;
        }

        if (!resp.ok) {
            console.warn('GitHub releases check failed', resp.status);
            return;
        }

        const newEtag = resp.headers.get('ETag');
        const data = await resp.json();
        const latestTag = data.tag_name || data.id;
        const localVersion = chrome.runtime.getManifest().version;
        // Ne notifier que si la release est plus récente que la version installée
        const isNewer = isVersionNewer(String(latestTag).replace(/^v/i, ''), localVersion);

        if (isNewer && latestTag !== lastSeen) {
            // New release
            chrome.notifications.create('igs_update_available', {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'Igensia Extension: nouvelle version disponible',
                message: `Version ${latestTag} disponible. Cliquez pour ouvrir la release sur GitHub.`,
                priority: 2
            });

            // store latest
            const obj = {};
            obj[STORAGE_KEY] = latestTag;
            if (newEtag) obj[STORAGE_KEY + '_etag'] = newEtag;
            chrome.storage.local.set(obj);
        } else {
            // update etag if changed
            if (newEtag && newEtag !== etag) {
                const obj = {};
                obj[STORAGE_KEY + '_etag'] = newEtag;
                chrome.storage.local.set(obj);
            }
        }
    } catch (err) {
        console.error('Error checking GitHub release:', err);
    }
}

// Alarm handler
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm && alarm.name === 'igs_check_release') {
        checkForGithubRelease();
        checkRemoteManifest();
    }
    if (alarm && alarm.name === 'igs_check_grades') {
        checkForNewGrades();
    }
    if (alarm && alarm.name === 'igs_time_flush') {
        queueTrackingRefresh();
    }
    if (alarm && alarm.name === 'igs_sync_edt') {
        syncEdt();
    }
});

// -------------------------
// Grade Alerts System
// -------------------------
// Page d'accueil E-Notes : liste des périodes de formation (une par année), chacune
// avec un lien « Mon relevé de notes » vers /home/releve?idinscription=XXX&ismultiplepf=True.
// L'idinscription change chaque année : on le lit sur cette page au lieu de le deviner.
const NOTES_HOME_URL = 'https://ws-notes-igs.wigorservices.net/Home/';
// Relevés lus à chaque synchro : l'année en cours + la précédente (la nouvelle année
// démarre sans notes, les « dernières notes » viennent alors de l'année d'avant)
const MAX_PERIODS_FETCHED = 2;
// v2 : une entrée par épreuve (l'ancien format ne gardait que la dernière ligne de chaque module)
const GRADES_STORAGE_KEY = 'igs_known_grades_v2';

function decodeEntities(text) {
    return text
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function stripTags(html) {
    return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// DOMParser n'existe pas dans un service worker MV3 : parsing du relevé par regex.
// Structure : <table class="table-notes"> avec th.col-5 = module, puis une ligne par épreuve
// (Épreuve | Date | Coefficient | Note).
function parseGradesFromHtml(html) {
    const grades = [];
    const chunks = html.split(/<table[^>]*class="[^"]*table-notes[^"]*"[^>]*>/i).slice(1);
    chunks.forEach(chunk => {
        const tableHtml = chunk.split(/<\/table>/i)[0];
        const nameMatch = tableHtml.match(/<th[^>]*class="[^"]*col-5[^"]*"[^>]*>([\s\S]*?)<\/th>/i);
        const moduleName = nameMatch ? stripTags(nameMatch[1]) : '';
        if (!moduleName) return;
        const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
        rows.forEach(row => {
            const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(stripTags);
            if (cells.length < 2) return;
            const noteMatch = cells[cells.length - 1].match(/^([A-D][+-]?|E|F)(?![A-Za-z])/);
            if (!noteMatch) return;
            grades.push({ name: moduleName, epreuve: cells[0] || '', date: cells[1] || '', coef: cells[2] || '', grade: noteMatch[1] });
        });
    });
    return { tableCount: chunks.length, grades };
}

function gradeKey(g) {
    return `${g.name}|${g.epreuve}|${g.date}|${g.grade}`;
}

function parseFrDate(text) {
    const m = String(text || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// Liens vers les relevés de la page d'accueil, avec les dates de la période.
// Chaque ligne affiche « école / code - libellé / jj/mm/aaaa - jj/mm/aaaa » puis le bouton :
// les infos d'un lien sont donc dans le HTML entre le lien précédent et lui.
function parseReleveLinks(html) {
    const links = [];
    const linkRegex = /href="([^"]*releve\?[^"]*idinscription=[^"]*)"/gi;
    let lastIndex = 0;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const before = stripTags(html.slice(lastIndex, match.index));
        lastIndex = match.index + match[0].length;
        const dates = before.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})(?!.*\d{2}\/\d{2}\/\d{4})/);
        links.push({
            url: new URL(decodeEntities(match[1]), NOTES_HOME_URL).href,
            start: dates ? parseFrDate(dates[1]) : null,
            end: dates ? parseFrDate(dates[2]) : null
        });
    }
    // Dédoublonner (un même lien peut apparaître deux fois : bouton + menu)
    return links.filter((l, i, arr) => arr.findIndex(o => o.url === l.url) === i);
}

// Renvoie { html } ou { login: true } si la session CAS a expiré
async function fetchNotesPage(url) {
    // Session ws-notes expirée : redirection vers le CAS (cas-p, dans host_permissions),
    // qui renvoie directement vers la page si la connexion CAS est encore valide.
    const resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (resp.url && new URL(resp.url).hostname.startsWith('cas-')) return { login: true };
    if (!resp.ok) return { html: '' };
    return { html: await resp.text() };
}

async function fetchCurrentGrades() {
    try {
        const home = await fetchNotesPage(NOTES_HOME_URL);
        if (home.login) return null;

        // Une seule période : l'accueil peut afficher directement le relevé
        const direct = parseGradesFromHtml(home.html);
        if (direct.tableCount > 0) {
            await chrome.storage.local.set({ igs_notes_url: NOTES_HOME_URL });
            return direct.grades;
        }

        const now = Date.now();
        const periods = parseReleveLinks(home.html)
            .filter(p => !p.start || p.start.getTime() <= now) // ignorer les périodes pas commencées
            .sort((a, b) => (b.start ? b.start.getTime() : 0) - (a.start ? a.start.getTime() : 0))
            .slice(0, MAX_PERIODS_FETCHED);
        if (!periods.length) return null;

        // Lien « Voir le relevé » du popup : la période en cours (la plus récente commencée)
        await chrome.storage.local.set({ igs_notes_url: periods[0].url });

        const grades = [];
        let found = false;
        for (const period of periods) {
            const page = await fetchNotesPage(period.url);
            if (page.login) return null;
            const parsed = parseGradesFromHtml(page.html);
            if (parsed.tableCount > 0 || /table-notes|RELEV/i.test(page.html)) found = true;
            grades.push(...parsed.grades);
        }
        return found ? grades : null;
    } catch (err) {
        console.log('Grades check: fetch failed', err);
        return null;
    }
}

async function checkForNewGrades() {
    try {
        const currentGrades = await fetchCurrentGrades();
        if (!currentGrades) {
            console.log('Grades check: not logged in or grades page not found');
            await chrome.storage.local.set({ igs_grades_sync_error: 'session' });
            return { ok: false, reason: 'session' };
        }

        const stored = await chrome.storage.local.get([GRADES_STORAGE_KEY, 'igs_grade_first_seen', 'igs_new_grades']);
        const knownGrades = stored[GRADES_STORAGE_KEY];

        // Date à laquelle chaque note a été vue pour la première fois : sert à
        // trier les « dernières notes » du popup quand l'épreuve n'a pas de date.
        const now = Date.now();
        const firstSeen = stored.igs_grade_first_seen || {};
        const latestGrades = currentGrades.map(g => {
            const key = gradeKey(g);
            if (!firstSeen[key]) firstSeen[key] = now;
            return { ...g, firstSeen: firstSeen[key] };
        });
        await chrome.storage.local.set({
            igs_latest_grades: latestGrades,
            igs_grade_first_seen: firstSeen,
            igs_grades_synced_at: now,
            igs_grades_sync_error: null
        });

        // Premier passage : on mémorise sans notifier (sinon toutes les notes seraient « nouvelles »)
        if (!Array.isArray(knownGrades)) {
            await chrome.storage.local.set({ [GRADES_STORAGE_KEY]: currentGrades });
            return { ok: true, newCount: 0 };
        }

        const knownSet = new Set(knownGrades.map(gradeKey));
        const newGrades = currentGrades.filter(g => !knownSet.has(gradeKey(g)));

        if (newGrades.length > 0) {
            // Cumuler avec les nouvelles notes pas encore vues dans le popup
            const pending = (stored.igs_new_grades || []).concat(newGrades);
            // Show notification
            chrome.notifications.create('igs_new_grade', {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: '📊 Nouvelle(s) note(s) disponible(s)!',
                message: newGrades.length === 1
                    ? `${newGrades[0].grade} en ${newGrades[0].name}`
                    : `${newGrades.length} nouvelles notes`,
                priority: 2
            });

            // Set badge
            chrome.action.setBadgeText({ text: String(pending.length) });
            chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });

            // Save new grade alert flag (vidé quand le popup affiche les notes)
            await chrome.storage.local.set({ igs_new_grades: pending });
        }

        // Update known grades
        await chrome.storage.local.set({ [GRADES_STORAGE_KEY]: currentGrades });
        return { ok: true, newCount: newGrades.length };

    } catch (err) {
        console.error('Error checking for new grades:', err);
        return { ok: false, reason: 'exception', error: String(err) };
    }
}

const GRADES_MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000;

async function syncGrades({ force = false } = {}) {
    const stored = await chrome.storage.local.get(['igs_grades_synced_at']);
    if (!force && stored.igs_grades_synced_at && Date.now() - stored.igs_grades_synced_at < GRADES_MIN_SYNC_INTERVAL_MS) {
        return { ok: true, skipped: true };
    }
    return checkForNewGrades();
}


// On install/startup: schedule alarms and run the checks once
function initBackgroundTasks() {
    chrome.alarms.create('igs_check_release', { periodInMinutes: 60 * 6 });
    chrome.alarms.create('igs_check_grades', { periodInMinutes: 120 }); // Check grades every 2 hours
    chrome.alarms.create('igs_time_flush', { periodInMinutes: 1 }); // Enregistre le temps passé chaque minute
    chrome.alarms.create('igs_sync_edt', { periodInMinutes: 60 });
    checkForGithubRelease();
    checkRemoteManifest();
    checkForNewGrades();
    syncEdt({ force: true });
    queueTrackingRefresh();
}

chrome.runtime.onInstalled.addListener(initBackgroundTasks);
chrome.runtime.onStartup.addListener(initBackgroundTasks);

// click on notification opens the appropriate page
chrome.notifications.onClicked.addListener(id => {
    if (id === 'igs_update_available') {
        chrome.tabs.create({ url: 'https://github.com/quelquun667/Igensia-Extension/releases/latest' });
    }
    if (id === 'igs_new_grade') {
        chrome.storage.local.get(['igs_notes_url'], res => {
            chrome.tabs.create({ url: res.igs_notes_url || NOTES_HOME_URL });
        });
        // Clear the badge
        chrome.action.setBadgeText({ text: '' });
    }
});

async function setUpdateFlag(value) {
    await chrome.storage.local.set({ igs_update_available: !!value });
}

// Compare two dotted version strings (e.g., '2.1.0' vs '2.0.5').
// Returns true if remote > local, else false.
function isVersionNewer(remote, local) {
    const pa = String(remote || '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(local || '').split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const a = pa[i] || 0;
        const b = pb[i] || 0;
        if (a > b) return true;
        if (a < b) return false;
    }
    return false;
}

// Check raw manifest.json on GitHub and compare version
async function checkRemoteManifest() {
    try {
        const localVersion = chrome.runtime.getManifest().version;
        const resp = await fetch(RAW_MANIFEST_URL, { cache: 'no-store' });
        if (!resp.ok) {
            console.warn('Remote manifest fetch failed', resp.status, resp.statusText);
            await setUpdateFlag(false); // évite badge bloqué
            return { ok: false, reason: 'fetch_failed', status: resp.status, statusText: resp.statusText };
        }
        const remote = await resp.json();
        const remoteVersion = String(remote.version || '').trim();

        const newer = isVersionNewer(remoteVersion, localVersion); // votre comparer existant
        await setUpdateFlag(newer); // <-- clé: true si update, false sinon

        if (newer) {
            // Optionnel: garder votre notification système si souhaitée
            // createNotification(remoteVersion);
            console.info('checkRemoteManifest: update available', { localVersion, remoteVersion });
            return { ok: true, updated: true, localVersion, remoteVersion };
        }
        console.info('checkRemoteManifest: no update', { localVersion, remoteVersion });
        return { ok: true, updated: false, localVersion, remoteVersion };
    } catch (e) {
        console.warn('checkRemoteManifest exception', e);
        await setUpdateFlag(false);
        return { ok: false, reason: 'exception', error: String(e) };
    }
}
