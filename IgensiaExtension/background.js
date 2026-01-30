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
        chrome.storage.local.get(['igs_time_stats'], res => {
            sendResponse({ ok: true, stats: res.igs_time_stats || {} });
        });
        return true;
    }
});

// -------------------------
// Time Tracking System
// -------------------------
let activeTabId = null;
let trackingStartTime = null;
const MONCAMPUS_DOMAINS = ['moncampus.igensia-education.fr', 'ws-notes-igs.wigorservices.net', 'ws-edt-igs.wigorservices.net', 'eabsences-igs.wigorservices.net'];

function isMonCampusUrl(url) {
    try {
        const hostname = new URL(url).hostname;
        return MONCAMPUS_DOMAINS.some(d => hostname.includes(d));
    } catch { return false; }
}

function getTodayKey() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

async function saveTimeSpent(seconds) {
    if (seconds < 1) return;
    const key = getTodayKey();
    const stored = await chrome.storage.local.get(['igs_time_stats']);
    const stats = stored.igs_time_stats || {};
    stats[key] = (stats[key] || 0) + seconds;
    await chrome.storage.local.set({ igs_time_stats: stats });
}

function startTracking() {
    if (!trackingStartTime) {
        trackingStartTime = Date.now();
    }
}

async function stopTracking() {
    if (trackingStartTime) {
        const elapsed = Math.floor((Date.now() - trackingStartTime) / 1000);
        trackingStartTime = null;
        await saveTimeSpent(elapsed);
    }
}

// Listen for tab activation
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await stopTracking();
    activeTabId = tabId;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && isMonCampusUrl(tab.url)) {
            startTracking();
        }
    } catch { }
});

// Listen for URL changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === activeTabId && changeInfo.url) {
        await stopTracking();
        if (isMonCampusUrl(changeInfo.url)) {
            startTracking();
        }
    }
});

// Stop tracking when window loses focus
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        await stopTracking();
    } else {
        // Check if active tab is MonCampus
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && activeTab.url && isMonCampusUrl(activeTab.url)) {
                startTracking();
            }
        } catch { }
    }
});

// Stop tracking when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (tabId === activeTabId) {
        await stopTracking();
        activeTabId = null;
    }
});

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

        if (!lastSeen || latestTag !== lastSeen) {
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
});

// -------------------------
// Grade Alerts System
// -------------------------
const GRADES_URL = 'https://ws-notes-igs.wigorservices.net/student/studentNotes?random=' + Math.random();
const GRADES_STORAGE_KEY = 'igs_known_grades';

async function checkForNewGrades() {
    try {
        // Fetch grades page (requires user to be logged in - using credentials)
        const resp = await fetch(GRADES_URL, { credentials: 'include' });
        if (!resp.ok) {
            console.log('Grades check: not logged in or fetch failed');
            return;
        }

        const html = await resp.text();

        // Parse grades from HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const tables = doc.querySelectorAll('.table-notes');

        if (!tables.length) {
            console.log('Grades check: no grades tables found');
            return;
        }

        // Collect current grades
        const currentGrades = [];
        tables.forEach(table => {
            const evalName = table.querySelector('th.col-5')?.textContent?.trim() || '';
            const noteCell = table.querySelector('tr:last-child td:last-child');
            const noteText = noteCell?.textContent?.trim()?.split('\n')[0]?.trim() || '';
            const noteMatch = noteText.match(/^([A-D][+-]?|E|F)/);
            if (evalName && noteMatch) {
                currentGrades.push({ name: evalName, grade: noteMatch[1] });
            }
        });

        if (!currentGrades.length) {
            return;
        }

        // Compare with stored grades
        const stored = await chrome.storage.local.get([GRADES_STORAGE_KEY]);
        const knownGrades = stored[GRADES_STORAGE_KEY] || [];
        const knownSet = new Set(knownGrades.map(g => `${g.name}|${g.grade}`));

        const newGrades = currentGrades.filter(g => !knownSet.has(`${g.name}|${g.grade}`));

        if (newGrades.length > 0) {
            // Show notification
            const gradesList = newGrades.map(g => `${g.grade} - ${g.name}`).join('\n');
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
            chrome.action.setBadgeText({ text: String(newGrades.length) });
            chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });

            // Save new grade alert flag
            await chrome.storage.local.set({ igs_new_grades: newGrades });
        }

        // Update known grades
        await chrome.storage.local.set({ [GRADES_STORAGE_KEY]: currentGrades });

    } catch (err) {
        console.error('Error checking for new grades:', err);
    }
}


// On install/startup: schedule an alarm (every 6 hours by default)
chrome.runtime.onInstalled.addListener(details => {
    chrome.alarms.create('igs_check_release', { periodInMinutes: 60 * 6 });
    chrome.alarms.create('igs_check_grades', { periodInMinutes: 120 }); // Check grades every 2 hours
    // run immediate check once
    checkForGithubRelease();
    checkRemoteManifest();
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create('igs_check_release', { periodInMinutes: 60 * 6 });
    chrome.alarms.create('igs_check_grades', { periodInMinutes: 120 });
    checkForGithubRelease();
    checkRemoteManifest();
});

// click on notification opens the appropriate page
chrome.notifications.onClicked.addListener(id => {
    if (id === 'igs_update_available') {
        chrome.tabs.create({ url: 'https://github.com/quelquun667/Igensia-Extension/releases/latest' });
    }
    if (id === 'igs_new_grade') {
        chrome.tabs.create({ url: 'https://ws-notes-igs.wigorservices.net/student/studentNotes' });
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
