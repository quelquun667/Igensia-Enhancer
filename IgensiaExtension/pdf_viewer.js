// Téléchargement en PDF des documents du visionneur MonCampus (documents non téléchargeables).
// Adapté de l'extension « PDF Picture » de ItzSized (https://github.com/ItzSized).
// Le bouton s'active/désactive dans les paramètres du popup : chrome.storage.sync.igs_pdf_button (true par défaut).
(() => {
  'use strict';
  if (window.__igpdfLoaded) return;
  window.__igpdfLoaded = true;

  // ---------------------------------------------------------------------------
  // Configuration. Les sélecteurs à null = détection automatique.
  // Si la détection échoue, inspecte le visionneur (F12) et renseigne-les ici.
  // ---------------------------------------------------------------------------
  const CONFIG = {
    containerSelector: null,   // zone qui défile, ex: '.viewer-container'
    pageSelector: null,        // éléments page, ex: '.page img' ou '.page canvas'
    toolbarSelector: null,     // barre d'outils noire, ex: '.viewer-toolbar'
    nextButtonSelector: null,  // bouton "page suivante" (visionneur page par page)
    minPageWidth: 250,         // ignore les icônes / miniatures
    minPageHeight: 250,
    scrollStepRatio: 0.8,      // fraction de la hauteur visible par pas de scroll
    settleDelay: 700,          // ms d'attente après chaque scroll (lazy loading)
    imageTimeout: 8000,
    jpegQuality: 0.92,
    pdfPageWidthPt: 595.28     // largeur A4 ; la hauteur suit le ratio de l'image
  };

  const BTN_ID = 'igpdf-btn';
  const BTN_LABEL = 'Télécharger en PDF';
  const SETTING_KEY = 'igs_pdf_button';
  const DOWNLOAD_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false;

  // ---------------------------------------------------------------------------
  // Détection du visionneur
  // ---------------------------------------------------------------------------
  function isBigEnough(el) {
    const r = el.getBoundingClientRect();
    return r.width >= CONFIG.minPageWidth && r.height >= CONFIG.minPageHeight;
  }

  function getPageElements(root) {
    if (CONFIG.pageSelector) return [...root.querySelectorAll(CONFIG.pageSelector)];
    const els = [...root.querySelectorAll('img, canvas')].filter(isBigEnough);
    if (els.length) return els;
    // Dernier recours : pages affichées en background-image CSS
    return [...root.querySelectorAll('div, section')].filter(
      (el) => isBigEnough(el) && getComputedStyle(el).backgroundImage.startsWith('url(')
    );
  }

  function isScrollable(el) {
    return /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) &&
      el.scrollHeight > el.clientHeight + 20;
  }

  function isDocScroller(el) {
    return el === document.scrollingElement || el === document.documentElement || el === document.body;
  }

  // Le conteneur qui défile et qui contient le plus de pages
  function findScrollContainer() {
    if (CONFIG.containerSelector) {
      const el = document.querySelector(CONFIG.containerSelector);
      if (el) return el;
    }
    const counts = new Map();
    for (const page of getPageElements(document)) {
      for (let el = page.parentElement; el && !isDocScroller(el); el = el.parentElement) {
        if (isScrollable(el)) {
          counts.set(el, (counts.get(el) || 0) + 1);
          break;
        }
      }
    }
    let best = null;
    let max = 0;
    for (const [el, n] of counts) if (n > max) { best = el; max = n; }
    return best || document.scrollingElement || document.documentElement;
  }

  // Indicateur "8 / 10" (ou "/ 10" à côté d'un <input>)
  function findPageIndicator() {
    let found = null;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.id === BTN_ID || el.children.length > 3) continue;
      const t = (el.textContent || '').trim();
      if (t.length <= 15 && /^\d*\s*\/\s*\d+$/.test(t) && el.getClientRects().length) {
        found = el; // ordre du document : on garde l'élément le plus profond
      }
    }
    return found;
  }

  function getPageInfo() {
    const ind = findPageIndicator();
    if (!ind) return null;
    let current = null;
    let total = null;
    for (const el of [ind, ind.parentElement]) {
      if (!el) continue;
      const t = el.textContent || '';
      total ??= +(t.match(/\/\s*(\d+)/) || [])[1] || null;
      const m = t.match(/(\d+)\s*\/\s*\d+/);
      if (m) { current = +m[1]; break; }
      const input = el.querySelector('input');
      if (input && /^\d+$/.test(input.value.trim())) { current = +input.value; break; }
    }
    return { el: ind, current, total };
  }

  function findToolbar() {
    if (CONFIG.toolbarSelector) return document.querySelector(CONFIG.toolbarSelector);
    const info = getPageInfo();
    // Sans indicateur de page (document d'une page) : barre d'outils de Box si elle existe
    if (!info) return document.querySelector('.bp-controls, .bp-toolbar') || null;
    // Remonte jusqu'au parent qui contient plusieurs boutons/icônes (loupe, zoom, plein écran)
    let el = info.el;
    for (let i = 0; i < 6 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.querySelectorAll('button, [role="button"], svg, i').length >= 3) return el;
    }
    return info.el.parentElement;
  }

  function findNextButton() {
    if (CONFIG.nextButtonSelector) return document.querySelector(CONFIG.nextButtonSelector);
    const scope = findToolbar() || document;
    return [...scope.querySelectorAll('button, [role="button"], a')].find((b) =>
      /suivant|next/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''} ${b.textContent || ''}`)
    ) || null;
  }

  // Conteneurs connus de visionneurs (Box Preview, PDF.js). Pour un document d'une
  // seule page, Box masque l'indicateur « 1 / 1 » : une page dans un de ces conteneurs suffit.
  const VIEWER_CONTAINERS = '.bp, .bp-doc, .bp-content, .pdfViewer, [data-page-number]';

  // Les simples grandes images (cartes de la liste des formations…) ne suffisent pas :
  // il faut une page dans un conteneur de visionneur connu, ou une page qui partage un
  // bloc proche avec l'indicateur « 3 / 7 » (visionneur non reconnu).
  function viewerDetected() {
    const pages = getPageElements(document);
    if (!pages.length) return false;
    if (pages.some((el) => el.closest(VIEWER_CONTAINERS))) return true;
    const info = getPageInfo();
    if (!info) return false;
    let block = info.el;
    for (let i = 0; i < 8 && block.parentElement; i++) {
      block = block.parentElement;
      if (pages.some((el) => block.contains(el))) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Capture d'une page (img / canvas / background-image) -> JPEG dataURL
  // ---------------------------------------------------------------------------
  function toJpeg(source, width, height) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; // évite un fond noir pour les zones transparentes
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    return { dataUrl: c.toDataURL('image/jpeg', CONFIG.jpegQuality), width, height };
  }

  function waitForImage(img) {
    if (img.complete && img.naturalWidth) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(resolve, CONFIG.imageTimeout);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  async function loadImage(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  }

  function fetchViaBackground(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'IGPDF_FETCH', url }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        res?.ok ? resolve(res.dataUrl) : reject(new Error(res?.error || 'échec du téléchargement'));
      });
    });
  }

  async function urlToJpeg(src) {
    let dataUrl = src;
    if (src.startsWith('blob:')) {
      const blob = await (await fetch(src)).blob();
      dataUrl = await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(blob);
      });
    } else if (!src.startsWith('data:')) {
      dataUrl = await fetchViaBackground(new URL(src, location.href).href);
    }
    const img = await loadImage(dataUrl);
    return toJpeg(img, img.naturalWidth, img.naturalHeight);
  }

  // Retourne null si la page n'est pas encore chargée (on réessaiera plus tard)
  async function captureElement(el) {
    if (el.tagName === 'CANVAS') {
      if (!el.width || !el.height) return null;
      return toJpeg(el, el.width, el.height); // lève une erreur si le canvas est "tainted"
    }
    if (el.tagName === 'IMG') {
      await waitForImage(el);
      if (el.naturalWidth < 50) return null; // placeholder de lazy loading
      try {
        return toJpeg(el, el.naturalWidth, el.naturalHeight);
      } catch {
        return urlToJpeg(el.currentSrc || el.src); // image cross-origin -> service worker
      }
    }
    const m = getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    return m ? urlToJpeg(m[1]) : null;
  }

  // Identifiant stable d'une page : numéro dans un attribut data-*, sinon position verticale
  function pageKey(el, container) {
    const holder = el.closest('[data-page-number],[data-page],[data-page-index],[data-index]');
    if (holder) {
      const d = holder.dataset;
      const v = d.pageNumber ?? d.page ?? d.pageIndex ?? d.index;
      if (v !== '' && !isNaN(v)) return { key: `n${v}`, order: +v };
    }
    const top = isDocScroller(container)
      ? el.getBoundingClientRect().top + window.scrollY
      : el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    return { key: `y${Math.round(top / 20)}`, order: top };
  }

  function isInView(el, container) {
    const r = el.getBoundingClientRect();
    const v = isDocScroller(container)
      ? { top: 0, bottom: window.innerHeight }
      : container.getBoundingClientRect();
    return r.bottom > v.top && r.top < v.bottom;
  }

  async function captureVisible(container, pages, errors) {
    const root = isDocScroller(container) ? document : container;
    for (const el of getPageElements(root)) {
      if (!isInView(el, container)) continue;
      const { key, order } = pageKey(el, container);
      if (pages.has(key)) continue;
      try {
        const shot = await captureElement(el);
        if (shot) pages.set(key, { ...shot, order });
      } catch (e) {
        errors.push(e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mode défilement : scroll progressif jusqu'en bas pour déclencher le lazy loading.
  // On capture à chaque pas, car certains visionneurs (type PDF.js) détruisent les
  // pages sorties de l'écran.
  // ---------------------------------------------------------------------------
  async function captureByScrolling(container, pages, errors, onProgress) {
    const doc = isDocScroller(container);
    const getTop = () => (doc ? window.scrollY : container.scrollTop);
    const setTop = (y) => (doc ? window.scrollTo(0, y) : (container.scrollTop = y));
    const viewH = () => (doc ? window.innerHeight : container.clientHeight);
    const maxTop = () => (doc ? document.scrollingElement.scrollHeight : container.scrollHeight) - viewH();

    const original = getTop();
    setTop(0);
    await sleep(CONFIG.settleDelay);

    let stuck = 0;
    for (;;) {
      await captureVisible(container, pages, errors);
      onProgress(pages.size);

      const before = getTop();
      if (before >= maxTop() - 2) {
        // En bas : on laisse une chance au visionneur d'ajouter des pages
        await sleep(CONFIG.settleDelay * 2);
        await captureVisible(container, pages, errors);
        onProgress(pages.size);
        if (before >= maxTop() - 2) break;
      }
      setTop(before + viewH() * CONFIG.scrollStepRatio);
      await sleep(CONFIG.settleDelay);
      if (Math.abs(getTop() - before) < 1) {
        if (++stuck >= 3) break;
      } else {
        stuck = 0;
      }
    }
    setTop(original);
  }

  // ---------------------------------------------------------------------------
  // Mode page par page : clique sur "page suivante" jusqu'à la dernière page
  // ---------------------------------------------------------------------------
  async function captureByPaging(total, pages, errors, onProgress) {
    const next = findNextButton();
    if (!next) throw new Error('Bouton "page suivante" introuvable : renseigne CONFIG.nextButtonSelector.');

    for (let guard = 0; guard < total + 5; guard++) {
      await sleep(CONFIG.settleDelay);
      const current = getPageInfo()?.current ?? pages.size + 1;
      const visible = getPageElements(document)
        .filter((el) => el.getClientRects().length)
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (visible && !pages.has(`n${current}`)) {
        try {
          const shot = await captureElement(visible);
          if (shot) pages.set(`n${current}`, { ...shot, order: current });
        } catch (e) {
          errors.push(e);
        }
      }
      onProgress(pages.size);
      if (current >= total) break;

      findNextButton()?.click();
      const deadline = Date.now() + CONFIG.imageTimeout;
      while (getPageInfo()?.current === current && Date.now() < deadline) await sleep(100);
    }
  }

  // ---------------------------------------------------------------------------
  // Génération du PDF avec jsPDF
  // ---------------------------------------------------------------------------
  function buildPdf(pageList, filename) {
    const { jsPDF } = window.jspdf;
    let pdf = null;
    for (const p of pageList) {
      const w = CONFIG.pdfPageWidthPt;
      const h = (w * p.height) / p.width;
      const orientation = w > h ? 'l' : 'p';
      if (!pdf) pdf = new jsPDF({ orientation, unit: 'pt', format: [w, h], compress: true });
      else pdf.addPage([w, h], orientation);
      pdf.addImage(p.dataUrl, 'JPEG', 0, 0, w, h, undefined, 'FAST');
    }
    pdf.save(filename);
  }

  // ---------------------------------------------------------------------------
  // Fichier PDF d'origine (texte sélectionnable). Le visionneur l'a forcément
  // téléchargé pour l'afficher : on parcourt les ressources chargées par la page
  // (performance) et le background les re-télécharge, en ne gardant que celle qui
  // commence par « %PDF- ». Les captures d'images ne servent qu'en dernier recours.
  // ---------------------------------------------------------------------------
  function isPdfBytes(bytes) {
    return bytes && bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
  }

  function dataUrlToBytes(dataUrl) {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function fetchPdfViaBackground(url) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'IGPDF_FETCH_PDF', url }, (res) => {
          if (chrome.runtime.lastError || !res?.ok || !res.pdf) return resolve(null);
          const bytes = dataUrlToBytes(res.pdf.dataUrl);
          resolve(isPdfBytes(bytes) ? { bytes, filename: res.pdf.filename, url } : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  const PDF_URL = /\.pdf(\?|#|$)/i;
  // Ressources qui ne peuvent pas être le document
  const STATIC_URL = /\.(m?js|css|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|map|json|html?)(\?|#|$)/i;
  const MAX_CANDIDATES = 20;

  function pdfCandidates() {
    const seen = new Set();
    const list = [];
    const add = (url, score) => {
      if (!/^https?:/i.test(url) || seen.has(url)) return;
      seen.add(url);
      list.push({ url, score });
    };
    for (const el of document.querySelectorAll('embed[src], object[data], iframe[src]')) {
      const src = el.getAttribute('src') || el.getAttribute('data');
      if (src) add(new URL(src, location.href).href, PDF_URL.test(src) ? 3 : 1);
    }
    for (const r of performance.getEntriesByType('resource')) {
      if (PDF_URL.test(r.name)) add(r.name, 3);
      else if (STATIC_URL.test(r.name)) continue;
      // Métadonnées de l'API Box (JSON), pas le document
      else if (/\/\/api\.box\.com\//i.test(r.name) && !/\/content(\?|$)/i.test(r.name)) continue;
      else if (!/^(img|css|link|script|beacon|audio|video|track|icon)$/.test(r.initiatorType)) {
        // Les gros fichiers et les URLs qui évoquent un document passent en premier
        const hint = /pdf|document|fichier|file|download|telecharg|stream|blob|content/i.test(r.name) ? 1 : 0;
        add(r.name, hint + Math.min(1, (r.encodedBodySize || r.transferSize || 0) / 200000));
      }
    }
    return list.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES).map((c) => c.url);
  }

  // Réponse PDF vue passer dans le trafic réseau de l'onglet (background, chrome.webRequest)
  function findPdfInTabTraffic() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'IGPDF_FIND_PDF' }, (res) => {
          if (chrome.runtime.lastError || !res?.ok || !res.pdf) return resolve(null);
          const bytes = dataUrlToBytes(res.pdf.dataUrl);
          resolve(isPdfBytes(bytes) ? { bytes, filename: res.pdf.filename, url: res.pdf.url } : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  // Téléchargement depuis la page elle-même : mêmes droits (CORS, cookies) que le
  // visionneur, quel que soit le domaine du fichier. On s'arrête dès les premiers
  // octets si ce n'est pas un PDF.
  async function fetchPdfDirect(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok || !res.body) return null;
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (chunks.length === 1 && size >= 5 && !isPdfBytes(value)) {
          reader.cancel().catch(() => {});
          return null;
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
      if (!isPdfBytes(bytes)) return null;
      const disposition = res.headers.get('content-disposition') || '';
      const named = disposition.match(/filename\*?\s*=\s*(?:[^']*'')?"?([^";]+)"?/i);
      let filename = '';
      if (named) {
        try { filename = decodeURIComponent(named[1].trim()); } catch { filename = named[1].trim(); }
      }
      return { bytes, filename, url };
    } catch {
      return null; // CORS ou réseau : on essaiera via le background
    }
  }

  async function findRealPdf() {
    const fromTraffic = await findPdfInTabTraffic();
    if (fromTraffic) return fromTraffic;
    // Secours : ressources chargées par la page
    const candidates = pdfCandidates();
    for (const url of candidates) {
      const pdf = (await fetchPdfDirect(url)) || (await fetchPdfViaBackground(url));
      if (pdf) return pdf;
    }
    // Diagnostic : à copier depuis la console (F12) si le PDF n'est pas trouvé
    console.warn("[Igensia PDF] Fichier d'origine introuvable. Candidats essayés :", candidates);
    console.warn('[Igensia PDF] Toutes les ressources de la page :',
      performance.getEntriesByType('resource').map((r) => `${r.initiatorType}  ${r.name.split('?')[0]}`));
    return null;
  }

  // ---------------------------------------------------------------------------
  // Nom du fichier : nom d'origine (serveur, URL, titre interne du PDF), sinon on
  // demande à l'utilisateur plutôt que d'utiliser le titre de la page.
  // ---------------------------------------------------------------------------
  function cleanFilename(name) {
    const base = String(name || '')
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return base ? `${base}.pdf` : '';
  }

  function nameFromUrl(url) {
    try {
      const last = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || '');
      return /\.pdf$/i.test(last) ? last : '';
    } catch {
      return '';
    }
  }

  // Titre du dictionnaire Info : /Title (texte) ou /Title <FEFF…> (UTF-16BE)
  function nameFromPdfTitle(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 65536)));
    for (const text of [tail, head]) {
      const hex = text.match(/\/Title\s*<([0-9A-Fa-f\s]+)>/);
      if (hex) {
        const h = hex[1].replace(/\s+/g, '');
        if (/^feff/i.test(h)) {
          let out = '';
          for (let i = 4; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
          if (out.trim()) return out.trim();
        }
      }
      const lit = text.match(/\/Title\s*\(((?:\\.|[^\\)])*)\)/);
      if (lit) {
        const value = lit[1].replace(/\\([()\\])/g, '$1');
        if (value.startsWith('\u00fe\u00ff')) {
          let out = '';
          for (let i = 2; i + 1 < value.length; i += 2) out += String.fromCharCode((value.charCodeAt(i) << 8) | value.charCodeAt(i + 1));
          if (out.trim()) return out.trim();
        } else if (value.trim()) {
          return value.trim();
        }
      }
    }
    return '';
  }

  function chooseFilename(real) {
    const found = [real.filename, nameFromUrl(real.url), nameFromPdfTitle(real.bytes)]
      .map(cleanFilename)
      .find(Boolean);
    return found || askFilename();
  }

  // Le titre de la page (« Voir la formation ») n'est pas le nom du document : on le demande
  function askFilename() {
    const answer = prompt('Nom du fichier PDF :', cleanFilename(document.title) || 'document.pdf');
    if (answer === null) return null; // annulé
    return cleanFilename(answer) || 'document.pdf';
  }

  function saveBytes(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------------
  async function run() {
    if (running) return;
    running = true;
    const btn = document.getElementById(BTN_ID);
    const setLabel = (txt) => { if (btn) btn.textContent = txt; };
    const resetLabel = () => { if (btn) btn.innerHTML = `${DOWNLOAD_ICON}<span>${BTN_LABEL}</span>`; };
    if (btn) btn.disabled = true;

    try {
      setLabel('Recherche du PDF…');
      const real = await findRealPdf();
      if (real) {
        const name = chooseFilename(real);
        if (name) saveBytes(real.bytes, name);
        return;
      }

      // Pas de fichier d'origine : PDF reconstitué à partir de captures des pages
      if (!confirm('Le fichier PDF d\'origine est introuvable pour ce document.\n\n' +
          'Créer un PDF à partir de captures des pages ? Le texte ne sera pas sélectionnable.')) {
        return;
      }
      if (!window.jspdf?.jsPDF) throw new Error('jsPDF est introuvable (lib/jspdf.umd.min.js).');

      const pages = new Map();
      const errors = [];
      const total = getPageInfo()?.total ?? null;
      const onProgress = (n) => setLabel(`Capture… ${n}${total ? ` / ${total}` : ''}`);

      const container = findScrollContainer();
      const scrollable = isDocScroller(container)
        ? document.scrollingElement.scrollHeight > window.innerHeight + 20
        : isScrollable(container);

      if (!scrollable && total > 1) {
        await captureByPaging(total, pages, errors, onProgress);
      } else {
        await captureByScrolling(container, pages, errors, onProgress);
      }

      const list = [...pages.values()].sort((a, b) => a.order - b.order);
      if (!list.length) {
        const detail = errors.length ? `\n\nErreur : ${errors[0].message}` : '';
        throw new Error(`Aucune page n'a pu être capturée.${detail}`);
      }
      if (total && list.length < total &&
          !confirm(`Seulement ${list.length} page(s) sur ${total} capturée(s). Générer le PDF quand même ?`)) {
        return;
      }

      setLabel('Génération du PDF…');
      await sleep(50); // laisse le navigateur rafraîchir le libellé
      const filename = askFilename();
      if (!filename) return;
      buildPdf(list, filename);
      if (errors.length) console.warn('[Igensia PDF] Pages en erreur :', errors);
    } catch (e) {
      console.error('[Igensia PDF]', e);
      alert(`Échec de l'export PDF : ${e.message}`);
    } finally {
      running = false;
      if (btn) btn.disabled = false;
      resetLabel();
    }
  }

  // ---------------------------------------------------------------------------
  // Injection du bouton (réinjecté si l'appli monopage reconstruit le DOM)
  // ---------------------------------------------------------------------------
  let enabled = false;

  // Le visionneur propose déjà un bouton « Télécharger » : le nôtre ne sert à rien
  const DOWNLOAD_WORDS = /t[ée]l[ée]charg|download/i;
  function nativeDownloadAvailable() {
    const candidates = document.querySelectorAll('a[download], button, a, [role="button"], [title], [aria-label], mat-icon, i, span.material-icons, span.material-symbols-outlined');
    for (const el of candidates) {
      if (el.closest(`#${BTN_ID}`) || !el.getClientRects().length) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const cls = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
      const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${cls}`;
      // Icônes Material : le nom de l'icône est le texte de l'élément
      const iconText = el.children.length === 0 ? (el.textContent || '').trim() : '';
      if (el.hasAttribute('download') || DOWNLOAD_WORDS.test(label) || /^(file_)?download$/i.test(iconText)) return true;
    }
    return false;
  }

  function ensureButton() {
    if (!enabled || !document.body) return;
    const existing = document.getElementById(BTN_ID);
    if (nativeDownloadAvailable()) {
      if (existing && !running) existing.remove();
      return;
    }
    if (!viewerDetected()) {
      // Navigation interne (document → liste des formations) : retirer le bouton
      if (existing && !running) existing.remove();
      return;
    }
    if (existing) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.innerHTML = `${DOWNLOAD_ICON}<span>${BTN_LABEL}</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      run();
    });
    const toolbar = findToolbar();
    if (toolbar) {
      toolbar.appendChild(btn);
    } else {
      btn.classList.add('igpdf-floating');
      document.body.appendChild(btn);
    }
  }

  // L'observateur (qui parcourt la page) ne tourne que si le bouton est activé
  let debounce = null;
  const observer = new MutationObserver(() => {
    if (running) return;
    clearTimeout(debounce);
    debounce = setTimeout(ensureButton, 500);
  });

  function setEnabled(value) {
    enabled = value !== false;
    if (enabled) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
      ensureButton();
    } else {
      observer.disconnect();
      clearTimeout(debounce);
      if (!running) document.getElementById(BTN_ID)?.remove();
    }
  }

  chrome.storage.sync.get(SETTING_KEY, (res) => setEnabled(res[SETTING_KEY]));
  // Changement du réglage dans le popup : appliqué sans recharger la page
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SETTING_KEY]) setEnabled(changes[SETTING_KEY].newValue);
  });
})();
