// Compte à rebours à côté des échéances de MonCampus :
// « Échéance d'envoi du fichier : 11/10/2026 à 23:59 » → « Il reste 2 j 12 h 26 min 50 s ».
// Les échéances sont repérées par leur texte, pas par la structure de la page : MonCampus
// est une application Vue qui reconstruit souvent son DOM.
// Réglage : chrome.storage.sync.igs_deadline_countdown (true par défaut), Paramètres → Outils.
(() => {
    'use strict';
    if (window.__igsCountdownLoaded) return;
    window.__igsCountdownLoaded = true;

    const SETTING_KEY = 'igs_deadline_countdown';
    const CHIP_CLASS = 'igs-countdown';
    const MAX_LINE_LENGTH = 400; // au-delà, le bloc n'est plus une ligne d'échéance
    const MAX_CLIMB = 4;         // libellé et date peuvent être dans des balises voisines
    const RESCAN_DELAY_MS = 300;

    // Heure après la date : « 23:59 » / « 23h59 » après un séparateur facultatif ; heure seule
    // (« 12h », « 12 heures ») uniquement après « à », « avant », « au plus tard », « jusqu'à »,
    // sinon « , 10 h de travail » serait lu comme une heure.
    const SEP = String.raw`(?:au plus tard(?:\s+à)?|avant|jusqu['’]à|à|a|,|-|–|—|·)`;
    const SEP_HOUR = String.raw`(?:au plus tard(?:\s+à)?|avant|jusqu['’]à|à)`;
    const TIME = String.raw`\s*(?:${SEP}\s*)?(\d{1,2})\s*[:hH]\s*(\d{2})|\s*${SEP_HOUR}\s*(\d{1,2})\s*h(?:eures?)?\b`;
    // Groupes : 1 jour, 2 mois, 3 année, 4 heure, 5 minutes, 6 heure seule
    const DEADLINE_RE = new RegExp(String.raw`[ÉEée]ch[ée]ance[^:\n]{0,80}:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:${TIME})?`, 'iy');
    // Heure placée hors de l'élément de la date (« <span>… 11/10/2026</span> à <b>12:00</b> ») :
    // séparateur obligatoire. Groupes : 1 heure, 2 minutes, 3 heure seule.
    const TIME_AFTER_RE = new RegExp(String.raw`\s*${SEP}\s*(\d{1,2})\s*[:hH]\s*(\d{2})|\s*${SEP_HOUR}\s*(\d{1,2})\s*h(?:eures?)?\b`, 'iy');
    const AMPM_RE = /\s*[ap]\.?\s?m\b/iy;
    const WORD_RE = /[ÉEée]ch[ée]ance/gi;
    // Où ne jamais rien ajouter : nos pastilles, champs éditables ou de formulaire, visionneur PDF
    const EXCLUDED = `.${CHIP_CLASS}, script, style, noscript, textarea, option, select, optgroup, datalist, svg, .bp, .pdfViewer, .textLayer, .annotationLayer`;
    const INLINE_WRAPPERS = /^(B|STRONG|EM|I|U|SPAN|SMALL|MARK|TIME|FONT)$/;
    const TIMER_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>';

    const tracked = new Map(); // nœud texte où finit l'échéance → pastille
    let enabled = false;
    let tickTimer = null;
    let rescanTimer = null;

    // ---------- Dates ----------
    function toDeadline(day, month, year, hour, minute) {
        const hasTime = hour != null;
        const h = hasTime ? hour : 23;
        const min = hasTime ? minute : 59;
        const date = new Date(year, month - 1, day, h, min, hasTime ? 0 : 59);
        // Date impossible (31/02, 25:00, heure sautée au changement d'heure…) : on l'écarte
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
            date.getHours() !== h || date.getMinutes() !== min) {
            return null;
        }
        return date;
    }

    // 2 j 03 h 05 min 09 s — les zéros gardent une largeur stable pendant le décompte
    function formatDuration(totalSeconds, withSeconds) {
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const pad = (n) => String(n).padStart(2, '0');
        const parts = [];
        if (d) parts.push(`${d} j`);
        if (d || h) parts.push(`${d ? pad(h) : h} h`);
        if (d || h || m) parts.push(`${d || h ? pad(m) : m} min`);
        if (withSeconds) parts.push(`${d || h || m ? pad(s) : s} s`);
        return parts.join(' ');
    }

    // Version en toutes lettres pour les lecteurs d'écran (à la minute près)
    function spokenDuration(totalSeconds) {
        if (totalSeconds < 60) return "moins d'une minute";
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const unit = (n, one, many) => `${n} ${n > 1 ? many : one}`;
        const parts = [];
        if (d) parts.push(unit(d, 'jour', 'jours'));
        if (h) parts.push(unit(h, 'heure', 'heures'));
        if (m) parts.push(unit(m, 'minute', 'minutes'));
        return parts.join(' ');
    }

    function chipState(deadline, now) {
        // Arrondi au-dessus : « Il reste 1 s » jusqu'à l'échéance, « dépassée » pile à l'heure
        const remaining = Math.ceil((deadline - now) / 1000);
        if (remaining <= 0) {
            const late = -remaining;
            return {
                level: 'overdue',
                text: late < 60 ? "Dépassée à l'instant" : `Dépassée depuis ${formatDuration(late, false)}`,
                spoken: late < 60 ? "Échéance dépassée à l'instant" : `Échéance dépassée depuis ${spokenDuration(late)}`
            };
        }
        const text = `Il reste ${formatDuration(remaining, true)}`;
        const spoken = `Il reste ${spokenDuration(remaining)}`;
        if (remaining < 3600) return { level: 'critical', text, spoken };
        if (remaining < 86400) return { level: 'urgent', text, spoken };
        if (remaining < 3 * 86400) return { level: 'soon', text, spoken };
        return { level: 'ok', text, spoken };
    }

    // ---------- Texte de la page ----------
    const isInChip = (node) => !!(node && (node.nodeType === 1 ? node : node.parentElement)?.closest(`.${CHIP_CLASS}`));

    // Texte d'un élément (sans nos pastilles) et position de chacun de ses nœuds texte.
    // null si l'élément est trop long : on mesure avant de parcourir, et le résultat est
    // mémorisé le temps d'une recherche (plusieurs nœuds partagent les mêmes ancêtres).
    function textModel(el, cache) {
        if (cache.has(el)) return cache.get(el);
        let length = el.textContent.length;
        for (const chip of el.querySelectorAll(`.${CHIP_CLASS}`)) length -= chip.textContent.length;
        let model = null;
        if (length <= MAX_LINE_LENGTH) {
            const segments = [];
            let text = '';
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                if (isInChip(n)) continue;
                segments.push({ node: n, start: text.length });
                text += n.nodeValue;
            }
            model = { text, segments };
        }
        cache.set(el, model);
        return model;
    }

    // Nœud texte qui contient le caractère juste avant `end`, et la position dans ce nœud
    function segmentEndingAt(model, end) {
        for (let k = model.segments.length - 1; k >= 0; k--) {
            const s = model.segments[k];
            if (s.start < end) return { node: s.node, offset: end - s.start };
        }
        return null;
    }

    // Le « : » qui suit « Échéance » doit appartenir au libellé : dans le même nœud texte, au
    // début du nœud suivant, ou dans des nœuds qui englobent le libellé (« <b>Échéance</b> d'envoi : »).
    // Sinon « STATUT DE L'ÉCHÉANCE » s'associerait à la date du champ d'à côté (« Déposé le : … »).
    function colonBelongsToLabel(model, labelNode, from) {
        const colon = model.text.indexOf(':', from);
        if (colon < 0) return false;
        const i = model.segments.findIndex((s) => s.node === labelNode);
        for (let k = i; k < model.segments.length; k++) {
            const s = model.segments[k];
            const holdsColon = colon >= s.start && colon < s.start + s.node.nodeValue.length;
            if (k > i) {
                const wrapsLabel = !!s.node.parentElement?.contains(labelNode);
                const startsWithColon = holdsColon && k === i + 1 && /^\s*:/.test(s.node.nodeValue);
                if (!wrapsLabel && !startsWithColon) return false;
            }
            if (holdsColon) return true;
        }
        return false;
    }

    // Échéance qui commence au mot « échéance » situé à `wordIndex` dans `labelNode`
    function matchFrom(labelNode, wordIndex, cache) {
        let el = labelNode.parentElement;
        for (let depth = 0; el && el !== document.body && depth < MAX_CLIMB; depth++, el = el.parentElement) {
            const model = textModel(el, cache);
            if (!model) return null; // bloc trop long
            const seg = model.segments.find((s) => s.node === labelNode);
            if (!seg) return null;
            const from = seg.start + wordIndex;
            DEADLINE_RE.lastIndex = from;
            const m = DEADLINE_RE.exec(model.text);
            if (!m) continue; // la date est peut-être dans une balise voisine : on remonte
            if (!colonBelongsToLabel(model, labelNode, from)) return null;
            return buildResult(el, model, m, cache);
        }
        return null;
    }

    function buildResult(el, model, m, cache) {
        let container = el;
        let endModel = model;
        let end = m.index + m[0].length;
        let hour = m[4] ?? m[6];
        let minute = m[5] ?? (m[6] != null ? '0' : undefined);

        // Heure dans l'élément parent, juste après la date
        if (hour == null && el.parentElement && el.parentElement !== document.body) {
            const parentModel = textModel(el.parentElement, cache);
            const endSeg = segmentEndingAt(model, end);
            const parentSeg = parentModel && endSeg && parentModel.segments.find((s) => s.node === endSeg.node);
            if (parentSeg) {
                const parentEnd = parentSeg.start + endSeg.offset;
                TIME_AFTER_RE.lastIndex = parentEnd;
                const t = TIME_AFTER_RE.exec(parentModel.text);
                if (t) {
                    hour = t[1] ?? t[3];
                    minute = t[2] ?? '0';
                    container = el.parentElement;
                    endModel = parentModel;
                    end = parentEnd + t[0].length;
                }
            }
        }
        // « 11:59 PM » : format non prévu, on n'affiche rien plutôt qu'une heure fausse
        if (hour != null) {
            AMPM_RE.lastIndex = end;
            if (AMPM_RE.test(endModel.text)) return null;
        }
        const deadline = toDeadline(+m[1], +m[2], +m[3], hour == null ? null : +hour, minute == null ? null : +minute);
        if (!deadline) return null;
        const anchorSeg = segmentEndingAt(endModel, end);
        return anchorSeg ? { anchor: anchorSeg.node, container, deadline } : null;
    }

    function acceptLabelNode(node) {
        const parent = node.parentElement;
        if (!parent || !/ch[ée]ance/i.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable || parent.closest(EXCLUDED)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
    }

    function findDeadlines() {
        const found = new Map(); // nœud d'ancrage → { anchor, container, deadline }
        const cache = new Map();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: acceptLabelNode });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            WORD_RE.lastIndex = 0;
            for (let w = WORD_RE.exec(node.nodeValue); w; w = WORD_RE.exec(node.nodeValue)) {
                const result = matchFrom(node, w.index, cache);
                if (result && !found.has(result.anchor)) found.set(result.anchor, result);
            }
        }
        return found;
    }

    // ---------- Pastilles ----------
    function lastMeaningfulChild(el) {
        let c = el.lastChild;
        while (c && ((c.nodeType === 1 && c.classList.contains(CHIP_CLASS)) || (c.nodeType === 3 && !c.nodeValue.trim()))) {
            c = c.previousSibling;
        }
        return c;
    }

    // Juste après la date/heure : on sort des balises de mise en forme qui l'entourent
    // (« <b>23:59</b> ») sans quitter la ligne, pour ne pas finir dans un <tr> ou une grille.
    function insertionPoint(anchor, container) {
        let target = anchor;
        for (let i = 0; i < 3; i++) {
            const parent = target.parentElement;
            if (!parent || parent === container || !container.contains(parent)) break;
            if (!INLINE_WRAPPERS.test(parent.tagName) || lastMeaningfulChild(parent) !== target) break;
            target = parent;
        }
        return target;
    }

    function createChip(deadline) {
        const chip = document.createElement('span');
        chip.className = CHIP_CLASS;
        chip.setAttribute('role', 'timer');
        chip.title = `Échéance : ${deadline.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        chip.innerHTML = TIMER_ICON; // icône fixe, aucun contenu de la page
        const visible = document.createElement('span');
        visible.className = `${CHIP_CLASS}-text`;
        visible.setAttribute('aria-hidden', 'true');
        // Nœud texte conservé : le modifier (characterData) ne réveille pas les autres
        // observateurs de la page, qui ne surveillent que les ajouts/retraits de nœuds.
        const textNode = visible.appendChild(document.createTextNode(''));
        const spoken = document.createElement('span');
        spoken.className = `${CHIP_CLASS}-sr`;
        const spokenNode = spoken.appendChild(document.createTextNode(''));
        chip.append(visible, spoken);
        return { chip, textNode, spokenNode, deadline, level: '' };
    }

    function renderChip(entry, now) {
        const { level, text, spoken } = chipState(entry.deadline, now);
        if (entry.textNode.data !== text) entry.textNode.data = text;
        if (entry.spokenNode.data !== spoken) entry.spokenNode.data = spoken;
        if (entry.level !== level) {
            if (entry.level) entry.chip.classList.remove(`is-${entry.level}`);
            entry.chip.classList.add(`is-${level}`);
            entry.level = level;
        }
    }

    function removeEntry(anchor) {
        const entry = tracked.get(anchor);
        if (entry) entry.chip.remove();
        tracked.delete(anchor);
    }

    function rescan() {
        rescanTimer = null;
        if (!enabled || !document.body) return;
        const found = findDeadlines();
        const now = Date.now();
        for (const anchor of [...tracked.keys()]) {
            if (!found.has(anchor) || !anchor.isConnected) removeEntry(anchor);
        }
        for (const [anchor, { container, deadline }] of found) {
            let entry = tracked.get(anchor);
            if (entry && entry.deadline.getTime() !== deadline.getTime()) {
                removeEntry(anchor);
                entry = null;
            }
            if (!entry) {
                entry = createChip(deadline);
                tracked.set(anchor, entry);
            }
            entry.target = insertionPoint(anchor, container);
            // Vue a pu retirer ou déplacer la pastille en redessinant la ligne : on la remet
            if (entry.chip.previousSibling !== entry.target) entry.target.after(entry.chip);
            renderChip(entry, now);
        }
        // Pastilles orphelines (copiées par la page, laissées par une ancienne version du script)
        const ours = new Set([...tracked.values()].map((e) => e.chip));
        for (const chip of document.querySelectorAll(`.${CHIP_CLASS}`)) {
            if (!ours.has(chip)) chip.remove();
        }
        updateTicking();
    }

    function scheduleRescan() {
        if (!rescanTimer) rescanTimer = setTimeout(rescan, RESCAN_DELAY_MS);
    }

    function tick() {
        if (document.hidden) return; // rattrapé au retour sur l'onglet (visibilitychange)
        const now = Date.now();
        for (const [anchor, entry] of tracked) {
            if (!anchor.isConnected || entry.chip.previousSibling !== entry.target) {
                scheduleRescan();
                continue;
            }
            renderChip(entry, now);
        }
    }

    // Calé sur l'horloge (juste après chaque seconde pile) : le décompte ne saute pas de seconde
    function scheduleTick() {
        tickTimer = setTimeout(() => {
            tickTimer = null;
            tick();
            updateTicking();
        }, 1000 - (Date.now() % 1000) + 20);
    }

    function updateTicking() {
        if (enabled && tracked.size) {
            if (!tickTimer) scheduleTick();
        } else if (tickTimer) {
            clearTimeout(tickTimer);
            tickTimer = null;
        }
    }

    // Changements de la page, en ignorant ceux de nos pastilles
    const observer = new MutationObserver((records) => {
        for (const r of records) {
            if (isInChip(r.target)) continue;
            const nodes = [...r.addedNodes, ...r.removedNodes];
            if (r.type === 'childList' && nodes.length && nodes.every((n) => n.nodeType === 1 && n.classList.contains(CHIP_CLASS))) continue;
            scheduleRescan();
            return;
        }
    });

    function setEnabled(value) {
        const next = value !== false;
        if (next === enabled) return;
        enabled = next;
        if (enabled) {
            observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
            rescan();
        } else {
            observer.disconnect();
            clearTimeout(rescanTimer);
            rescanTimer = null;
            for (const anchor of [...tracked.keys()]) removeEntry(anchor);
            document.querySelectorAll(`.${CHIP_CLASS}`).forEach((chip) => chip.remove());
            updateTicking();
        }
    }

    document.addEventListener('visibilitychange', () => { if (!document.hidden && enabled) tick(); });

    chrome.storage.sync.get(SETTING_KEY, (res) => setEnabled(res[SETTING_KEY]));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[SETTING_KEY]) setEnabled(changes[SETTING_KEY].newValue);
    });
})();
