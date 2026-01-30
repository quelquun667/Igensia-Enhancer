(function () {
    console.log("Igensia Enhancer: Content script loaded.");

    // Theme application was removed per user request: the popup will manage preview only.

    const noteMapping = {
        "A+": 4.0, "A": 4.0, "A-": 3.7,
        "B+": 3.3, "B": 3.0, "B-": 2.7,
        "C+": 2.3, "C": 2.0, "C-": 1.7,
        "D+": 1.3, "D": 1.0, "D-": 0.7,
        "E": 0.0, "F": 0.0, "ABS": 0.0, "Disp": 0.0
    };

    const passingGrades = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C"];

    // Utility: wrap chrome.runtime.sendMessage in a Promise and check lastError to avoid uncaught "Extension context invalidated" errors
    function safeSendMessage(message, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            let finished = false;
            try {
                chrome.runtime.sendMessage(message, resp => {
                    finished = true;
                    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                    resolve(resp);
                });
            } catch (e) {
                return reject(e);
            }
            // Timeout to avoid hanging indefinitely if the runtime doesn't respond
            setTimeout(() => {
                if (!finished) reject(new Error('No response from extension runtime'));
            }, timeoutMs);
        });
    }

    function convertNoteToGPA(note) {
        return noteMapping[note.trim()] !== undefined ? noteMapping[note.trim()] : null;
    }

    function isModuleValidated(noteText) {
        return passingGrades.includes(noteText.trim());
    }

    let originalTablesOrder = []; // Pour stocker l'ordre original des tables

    // Variable pour stocker les notes simulées (effacées au refresh)
    let simulatedGrades = []; // { moduleName, grade, coefficient }

    // Avertissement avant de quitter si des notes simulées existent
    window.addEventListener('beforeunload', (e) => {
        if (simulatedGrades.length > 0) {
            e.preventDefault();
            e.returnValue = 'Vous avez des notes simulées non sauvegardées. Êtes-vous sûr de vouloir quitter ?';
        }
    });

    function calculateAndDisplaySummary() {
        const noteTables = document.querySelectorAll('.table-notes');
        const absTables = document.querySelectorAll('.table-absences');
        const tables = noteTables;
        let totalGPA = 0;
        let totalCoeff = 0;
        let validatedModulesCount = 0;
        let totalModules = 0;
        // Si on est sur une page de notes
        const mainContainer = document.querySelector('.main-container');
        if (!mainContainer) return;

        let summaryDiv = document.querySelector('.igensia-enhancer-summary');
        if (!summaryDiv) {
            summaryDiv = document.createElement('div');
            summaryDiv.className = 'igensia-enhancer-summary';
            summaryDiv.style.marginTop = '20px';
            summaryDiv.style.padding = '10px';
            summaryDiv.style.border = '1px solid #ccc';
            summaryDiv.style.borderRadius = '8px';
            mainContainer.prepend(summaryDiv);
        }

        // Ajuster les couleurs en fonction du mode sombre
        if (document.body.classList.contains('dark-mode')) {
            summaryDiv.style.backgroundColor = 'var(--dark-content-background-color)';
            summaryDiv.style.color = 'var(--dark-color)';
            summaryDiv.style.borderColor = '#434343';
        } else {
            summaryDiv.style.backgroundColor = '#f9f9f9';
            summaryDiv.style.color = '#333';
            summaryDiv.style.borderColor = '#ccc';
        }

        if (noteTables && noteTables.length > 0) {
            // Comportement original pour les notes
            // Réinitialiser originalTablesOrder si c'est la première fois ou si les tables ont changé
            if (originalTablesOrder.length === 0 || originalTablesOrder.length !== tables.length) {
                originalTablesOrder = Array.from(tables).map(table => {
                    const noteElement = table.querySelector('tr:last-child td:last-child');
                    const noteText = noteElement ? noteElement.textContent.trim() : '';
                    return { table, validated: isModuleValidated(noteText) };
                });
            }

            tables.forEach(table => {
                const noteElement = table.querySelector('tr:last-child td:last-child');
                const coeffElement = table.querySelector('tr:last-child td:nth-child(3)');

                if (noteElement && coeffElement) {
                    const noteTextRaw = noteElement.textContent.trim();
                    // Extraire uniquement la note brute (avant tout span/annotation)
                    const noteText = noteTextRaw.split('\n')[0].trim();
                    const coefficient = parseFloat(coeffElement.textContent.trim());

                    const gpa = convertNoteToGPA(noteText);

                    // Si la note est '-' ou vide, considérer qu'elle n'est pas encore saisie : ne pas afficher 'Non validé' et ne pas compter
                    const isEmptyNote = noteText === '' || noteText === '-';

                    if (!isEmptyNote) {
                        totalModules++;
                        // Éviter d'ajouter le span si déjà présent
                        if (!noteElement.querySelector('span')) {
                            if (isModuleValidated(noteText)) {
                                validatedModulesCount++;
                                noteElement.innerHTML += ' <span style="color: green; font-weight: bold;">(Validé)</span>';
                            } else {
                                noteElement.innerHTML += ' <span style="color: red; font-weight: bold;">(Non validé)</span>';
                            }
                        } else {
                            if (isModuleValidated(noteText)) {
                                validatedModulesCount++;
                            }
                        }

                        if (gpa !== null && !isNaN(coefficient) && coefficient > 0) {
                            totalGPA += gpa * coefficient;
                            totalCoeff += coefficient;
                        }
                    } else {
                        // Si note vide, on ne fait rien (pas de label '(Non validé)')
                    }
                }
            });

            const averageGPA = totalCoeff > 0 ? (totalGPA / totalCoeff).toFixed(2) : 'N/A';
            const validatedPercentage = totalModules > 0 ? ((validatedModulesCount / totalModules) * 100).toFixed(2) : 'N/A';

            summaryDiv.innerHTML = `
                <p><strong>Moyenne pondérée (GPA) : ${averageGPA}</strong></p>
                <p><strong>Modules validés : ${validatedModulesCount} / ${totalModules} (${validatedPercentage}%)</strong></p>
                <div id="sort-buttons" style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 5px;">
                    <button id="sortValidated" class="igensia-enhancer-button">Trier par Validés</button>
                    <button id="sortNonValidated" class="igensia-enhancer-button">Trier par Non Validés</button>
                    <button id="sortByDate" class="igensia-enhancer-button">Trier par Date</button>
                    <button id="sortNormal" class="igensia-enhancer-button">Ordre Normal</button>
                    <button id="toggleChart" class="igensia-enhancer-button">Afficher Graphique</button>
                </div>
                <div id="search-container" style="margin-top: 10px; display: flex; gap: 5px;">
                    <input type="text" id="teacherSearchInput" placeholder="Rechercher par formateur ou évaluation" style="flex-grow: 1; padding: 8px; border-radius: 5px; border: 1px solid #ccc;">
                    <button id="resetSearchButton" class="igensia-enhancer-button">Réinitialiser</button>
                    <label style="display:flex; align-items:center; gap:6px; margin-left:8px; white-space:nowrap;">
                        <input type="checkbox" id="onlyWithNotesCheckbox" />
                        <span style="font-size:13px;">Afficher uniquement matières avec notes</span>
                    </label>
                </div>
                <div id="notesChartContainer" style="display: none; margin-top: 20px; padding: 15px; border-radius: 8px;">
                    <h3>Répartition des notes</h3>
                    <div id="notesChart" style="width: 100%; height: 200px; display: flex; align-items: flex-end; justify-content: space-around;"></div>
                </div>
                <div id="gradeSimulatorContainer" style="margin-top: 20px; padding: 15px; border: 2px dashed #888; border-radius: 8px;">
                    <h3 style="margin-bottom: 10px;">📊 Simulateur de Notes</h3>
                    <p style="font-size: 12px; opacity: 0.7; margin-bottom: 10px;">Ajoutez des notes hypothétiques pour simuler votre moyenne. Les notes simulées disparaîtront au rafraîchissement.</p>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                        <select id="simModuleSelect" style="padding: 8px; border-radius: 5px; border: 1px solid #ccc; flex: 1; min-width: 200px;"></select>
                        <select id="simGradeSelect" style="padding: 8px; border-radius: 5px; border: 1px solid #ccc;">
                            <option value="A">A (4.0)</option>
                            <option value="A-">A- (3.7)</option>
                            <option value="B+">B+ (3.3)</option>
                            <option value="B">B (3.0)</option>
                            <option value="B-">B- (2.7)</option>
                            <option value="C+">C+ (2.3)</option>
                            <option value="C">C (2.0)</option>
                            <option value="C-">C- (1.7)</option>
                            <option value="D+">D+ (1.3)</option>
                            <option value="D">D (1.0)</option>
                            <option value="D-">D- (0.7)</option>
                            <option value="E">E (0.0)</option>
                        </select>
                        <input type="number" id="simCoeffInput" placeholder="Coeff" value="1" min="0.1" step="0.1" style="padding: 8px; border-radius: 5px; border: 1px solid #ccc; width: 70px;" />
                        <button id="addSimGrade" class="igensia-enhancer-button" style="background-color: #28a745 !important; border-color: #28a745 !important;">+ Ajouter</button>
                    </div>
                    <div id="simGradesList" style="margin-top: 15px;"></div>
                    <div id="simAverageDisplay" style="margin-top: 15px; padding: 10px; border-radius: 5px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; display: none;">
                        <strong>🔮 Moyenne simulée (GPA) : <span id="simAverageValue">N/A</span></strong>
                        <p style="font-size: 11px; margin-top: 5px; opacity: 0.9;">⚠️ Cette moyenne inclut vos notes simulées et est hypothétique.</p>
                    </div>
                </div>
            `;

            // Appliquer les styles et les gestionnaires uniquement pour la page de notes
            const notesChartContainer = document.getElementById('notesChartContainer');
            const teacherSearchInput = document.getElementById('teacherSearchInput');
            const resetSearchButton = document.getElementById('resetSearchButton');

            if (document.body.classList.contains('dark-mode')) {
                notesChartContainer.style.backgroundColor = 'var(--dark-content-background-color)';
                notesChartContainer.style.color = 'var(--dark-color)';
                notesChartContainer.style.borderColor = '#434343';
                teacherSearchInput.style.backgroundColor = 'var(--dark-primary-color)';
                teacherSearchInput.style.color = 'var(--dark-color)';
                teacherSearchInput.style.borderColor = '#434343';
                teacherSearchInput.style.setProperty('--placeholder-color', 'darkgray'); // Custom property for placeholder
            } else {
                notesChartContainer.style.backgroundColor = '#f9f9f9';
                notesChartContainer.style.color = '#333';
                notesChartContainer.style.borderColor = '#ccc';
                teacherSearchInput.style.backgroundColor = 'white';
                teacherSearchInput.style.color = '#333';
                teacherSearchInput.style.borderColor = '#ccc';
                teacherSearchInput.style.setProperty('--placeholder-color', 'lightgray');
            }

            // Appliquer les styles aux boutons
            const buttons = summaryDiv.querySelectorAll('.igensia-enhancer-button');
            buttons.forEach(button => {
                button.style.padding = '8px 12px';
                button.style.borderRadius = '5px';
                button.style.border = '1px solid';
                button.style.cursor = 'pointer';
                button.style.marginRight = '5px';
                button.style.transition = 'background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease';

                if (document.body.classList.contains('dark-mode')) {
                    button.style.backgroundColor = 'var(--secondary-color)';
                    button.style.color = 'white';
                    button.style.borderColor = 'var(--secondary-color)';
                } else {
                    button.style.backgroundColor = 'var(--secondary-color)';
                    button.style.color = 'white';
                    button.style.borderColor = 'var(--secondary-color)';
                }
            });

            const sortValidatedButton = document.getElementById('sortValidated');
            const sortNonValidatedButton = document.getElementById('sortNonValidated');
            const sortNormalButton = document.getElementById('sortNormal');
            const toggleChartButton = document.getElementById('toggleChart');

            sortValidatedButton.addEventListener('click', () => {
                sortTables('validated');
                setActiveButton(sortValidatedButton);
            });
            sortNonValidatedButton.addEventListener('click', () => {
                sortTables('nonValidated');
                setActiveButton(sortNonValidatedButton);
            });
            sortNormalButton.addEventListener('click', () => {
                sortTables('normal');
                setActiveButton(sortNormalButton);
            });

            // Tri par date
            const sortByDateButton = document.getElementById('sortByDate');
            sortByDateButton.addEventListener('click', () => {
                sortTablesByDate();
                setActiveButton(sortByDateButton);
            });

            toggleChartButton.addEventListener('click', () => {
                if (notesChartContainer.style.display === 'none') {
                    notesChartContainer.style.display = 'block';
                    toggleChartButton.textContent = 'Masquer Graphique';
                    setTimeout(() => {
                        console.log("Calling generateNotesChart after timeout.");
                        generateNotesChart();
                    }, 50);
                } else {
                    notesChartContainer.style.display = 'none';
                    toggleChartButton.textContent = 'Afficher Graphique';
                }
            });

            teacherSearchInput.addEventListener('input', filterTablesByTeacherOrEval);
            resetSearchButton.addEventListener('click', resetTableFilter);

            // Checkbox: afficher uniquement les matières qui contiennent une note
            const onlyWithNotesCheckbox = document.getElementById('onlyWithNotesCheckbox');
            // Restore saved preference
            try {
                const saved = localStorage.getItem('igsOnlyWithNotes');
                if (saved === '1') {
                    onlyWithNotesCheckbox.checked = true;
                    // Appliquer le filtre immédiatement si la checkbox était cochée
                    setTimeout(() => applyCurrentFilters(), 100);
                }
            } catch (e) { /* ignore */ }
            onlyWithNotesCheckbox.addEventListener('change', () => {
                try { localStorage.setItem('igsOnlyWithNotes', onlyWithNotesCheckbox.checked ? '1' : '0'); } catch (e) { }
                applyCurrentFilters();
            });

            // Ne pas afficher ni récupérer les absences sur la page des notes.

            // Définir le bouton "Ordre Normal" comme actif par défaut
            setActiveButton(sortNormalButton);

            // Initialiser le simulateur de notes
            initGradeSimulator();
        } else if (absTables && absTables.length > 0) {
            // Page d'absences: afficher uniquement le résumé des absences + recherche
            summaryDiv.innerHTML = `
                <div id="absencesContainer" style="margin-top: 10px; padding: 10px; border-radius: 8px;">
                    <h3>Absences</h3>
                    <div style="display:flex; gap:8px; margin-top:8px;">
                        <input type="text" id="absenceSearchInput" placeholder="Rechercher par matière ou action" style="flex:1; padding:6px; border-radius:4px; border:1px solid #ccc;">
                        <button id="resetAbsenceSearch" class="igensia-enhancer-button">Réinitialiser</button>
                    </div>
                    <p id="absencesSummary">Chargement des absences...</p>
                </div>
            `;

            // Écouteurs pour la recherche
            const absenceSearchInput = document.getElementById('absenceSearchInput');
            const resetAbsenceSearch = document.getElementById('resetAbsenceSearch');
            absenceSearchInput.addEventListener('input', () => {
                filterAbsenceTables(absenceSearchInput.value.trim().toLowerCase());
            });
            resetAbsenceSearch.addEventListener('click', () => {
                absenceSearchInput.value = '';
                filterAbsenceTables('');
            });

            // Calculer et afficher les totaux initiaux (depuis le document courant si possible)
            // (Cette page est la page d'absences donc on exécute le calcul)
            fetchAndDisplayAbsences(document);
        } else {
            // Ni notes ni absences : ne pas injecter l'UI
            if (summaryDiv && summaryDiv.parentNode) {
                summaryDiv.remove();
            }
        }

    }

    // ----- Absences -----
    // URL fournie par l'utilisateur (sera utilisée pour la requête)
    const ABSENCES_URL = 'https://eabsences-igs.wigorservices.net/home/item?idinscription=370065&ismultiplepf=True';

    // fetchAndDisplayAbsences now accepts an optional Document to compute totals from (useful when already on the absences page)
    async function fetchAndDisplayAbsences(doc = null) {
        const absencesSummaryEl = document.getElementById('absencesSummary');
        if (!absencesSummaryEl) return;

        try {
            let useDoc = doc;
            if (!useDoc) {
                try {
                    const resp = await fetch(ABSENCES_URL, { credentials: 'include' });
                    if (!resp.ok) {
                        absencesSummaryEl.textContent = `Erreur lors de la récupération des absences: ${resp.status}`;
                        return;
                    }
                    const text = await resp.text();
                    const parser = new DOMParser();
                    useDoc = parser.parseFromString(text, 'text/html');
                } catch (fetchErr) {
                    // Direct fetch failed (likely CORS or network). Try asking the background service worker to perform the request.
                    console.warn('Direct fetch failed, attempting background fetch fallback:', fetchErr);
                    try {
                        const bgResp = await safeSendMessage({ action: 'fetchUrl', url: ABSENCES_URL });
                        if (bgResp && bgResp.ok && bgResp.text) {
                            const parser = new DOMParser();
                            useDoc = parser.parseFromString(bgResp.text, 'text/html');
                        } else {
                            absencesSummaryEl.textContent = 'Impossible de récupérer les absences (erreur réseau).';
                            return;
                        }
                    } catch (bgErr) {
                        console.error('Background fetch failed:', bgErr);
                        absencesSummaryEl.textContent = 'Impossible de récupérer les absences (erreur).';
                        return;
                    }
                }
            }

            // On prend les tables depuis useDoc mais si useDoc est le document courant, préférer les tables visibles
            const tables = Array.from(useDoc.querySelectorAll('.table-absences'));
            let totalJustifie = 0.0;
            let totalInjustifie = 0.0;
            let totalRetards = 0.0;

            // Fonction utilitaire pour extraire un nombre d'une string (comme '3.50' ou '0,00')
            const parseNum = s => {
                if (!s) return 0;
                const n = parseFloat(s.replace(',', '.').match(/[-0-9.,]+/)?.[0] || '0');
                return isNaN(n) ? 0 : n;
            };

            tables.forEach(table => {
                // Si on travaille sur le document courant (useDoc === document), filtrer les tables cachées
                if (useDoc === document && table.style && table.style.display === 'none') return;

                // Chercher la ligne de totaux: souvent la dernière tr avec des th colspan
                const footerRow = Array.from(table.querySelectorAll('tr')).reverse().find(tr => tr.textContent && tr.textContent.toLowerCase().includes('total des absences'));
                if (footerRow) {
                    // Le footerRow peut contenir plusieurs lignes séparées par des <br>
                    const lines = footerRow.innerText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    lines.forEach(line => {
                        const lower = line.toLowerCase();
                        const num = parseNum(line);
                        if (lower.includes('injust')) {
                            totalInjustifie += num;
                        } else if (lower.includes('absences justif') || (lower.includes('justif') && !lower.includes('injust'))) {
                            totalJustifie += num;
                        } else if (lower.includes('retard') || lower.includes('exclusion')) {
                            totalRetards += num;
                        }
                    });
                } else {
                    // fallback: sommer la colonne Nb Heure des lignes de contenu (td)
                    const rows = Array.from(table.querySelectorAll('tr'));
                    rows.forEach(r => {
                        const cells = r.querySelectorAll('td');
                        if (!cells || cells.length < 2) return;
                        // la colonne 'Nature' est généralement la 2ème colonne
                        const nature = (cells[1].textContent || '').toLowerCase();
                        // chercher la colonne Nb Heure — souvent la dernière
                        const nbCell = cells[cells.length - 1];
                        const h = parseNum(nbCell ? nbCell.textContent.trim() : '0');
                        if (nature.includes('retard') || nature.includes('exclusion')) {
                            totalRetards += h;
                        } else if (nature.includes('absence')) {
                            if (nature.includes('justif')) totalJustifie += h;
                            else totalInjustifie += h; // si 'absence' mais pas 'justif', on considère non justifiée
                        }
                    });
                }
            });

            // Si useDoc est document courant, on veut recalculer uniquement pour les tables visibles (après filtrage)
            if (useDoc === document) {
                // nothing extra — the Table filtering above already respected display
            }

            absencesSummaryEl.textContent = `Justifiées: ${totalJustifie.toFixed(2)} — Non justifiées: ${totalInjustifie.toFixed(2)} — Retards/Exclusions: ${totalRetards.toFixed(2)}`;
        } catch (err) {
            console.error('Erreur fetch absences:', err);
            absencesSummaryEl.textContent = 'Impossible de récupérer les absences (erreur).';
        }
    }

    // Filtre les tables d'absences sur la page courante et recalcule les totaux affichés
    function filterAbsenceTables(query) {
        const tables = Array.from(document.querySelectorAll('.table-absences'));
        tables.forEach(table => {
            let matchText = '';
            // Chercher un .action-header juste avant la table (ou un parent) qui contient le nom du cours/action
            let header = table.previousElementSibling;
            while (header && header.nodeType === 1 && header.classList && !header.classList.contains('action-header')) {
                header = header.previousElementSibling;
            }
            if (header && header.classList && header.classList.contains('action-header')) {
                matchText = header.textContent.trim().toLowerCase();
            } else {
                // fallback: utiliser le texte de la table
                matchText = table.textContent.trim().toLowerCase();
            }

            if (!query || matchText.includes(query)) {
                table.style.display = '';
                if (header) header.style.display = '';
            } else {
                table.style.display = 'none';
                if (header) header.style.display = 'none';
            }
        });
        // Recalculer les totaux à partir du document courant (tables visibles)
        fetchAndDisplayAbsences(document);
    }

    function filterTablesByTeacherOrEval() {
        const searchTerm = document.getElementById('teacherSearchInput').value.toLowerCase();
        const notesContainer = document.querySelector('.text-center > div:last-child');
        if (!notesContainer) return;
        // Use combined logic: teacher/eval search AND only-with-notes checkbox
        applyCurrentFilters();
    }

    function resetTableFilter() {
        document.getElementById('teacherSearchInput').value = '';
        const notesContainer = document.querySelector('.text-center > div:last-child');
        if (!notesContainer) return;
        // Reset search but keep the 'only with notes' checkbox state
        applyCurrentFilters();
    }

    // Returns true if the provided table contains a real note (not empty and not '-')
    function tableHasNote(table) {
        try {
            const noteElement = table.querySelector('tr:last-child td:last-child');
            if (!noteElement) return false;
            const raw = noteElement.textContent || '';
            const txt = raw.trim();
            if (!txt || txt === '-') return false;
            // Sometimes innerHTML contains appended '(Validé)' labels; strip parentheses parts
            const normalized = txt.split('\n')[0].split('(')[0].trim();
            return normalized !== '' && normalized !== '-';
        } catch (e) { return false; }
    }

    // Apply current filters: teacher search + only-with-notes checkbox
    function applyCurrentFilters() {
        const searchTerm = (document.getElementById('teacherSearchInput') && document.getElementById('teacherSearchInput').value.toLowerCase()) || '';
        const onlyWith = (document.getElementById('onlyWithNotesCheckbox') && document.getElementById('onlyWithNotesCheckbox').checked) || false;
        originalTablesOrder.forEach(item => {
            let matchesSearch = false;
            try {
                const teacherElement = item.table.querySelector('th.col-4');
                const evalNameElement = item.table.querySelector('th.col-5');
                if (searchTerm === '') matchesSearch = true;
                if (!matchesSearch && teacherElement) {
                    const teacherName = teacherElement.textContent.toLowerCase();
                    if (teacherName.includes(searchTerm)) matchesSearch = true;
                }
                if (!matchesSearch && evalNameElement) {
                    const evalName = evalNameElement.textContent.toLowerCase();
                    if (evalName.includes(searchTerm)) matchesSearch = true;
                }
            } catch (e) { matchesSearch = true; }

            const hasNote = tableHasNote(item.table);
            const shouldShow = matchesSearch && (!onlyWith || hasNote);
            item.table.style.display = shouldShow ? '' : 'none';
        });
        // If currently sorted differently, we keep the order but filters apply to visibility.
    }

    function setActiveButton(activeButton) {
        const buttons = document.querySelectorAll('.igensia-enhancer-button');
        buttons.forEach(button => {
            button.classList.remove('active');
            // Réinitialiser les styles pour les boutons inactifs
            if (document.body.classList.contains('dark-mode')) {
                button.style.backgroundColor = 'var(--secondary-color)';
                button.style.color = 'white';
                button.style.borderColor = 'var(--secondary-color)';
            } else {
                button.style.backgroundColor = 'var(--secondary-color)';
                button.style.color = 'white';
                button.style.borderColor = 'var(--secondary-color)';
            }
        });

        activeButton.classList.add('active');
        // Styles pour le bouton actif
        if (document.body.classList.contains('dark-mode')) {
            activeButton.style.backgroundColor = 'var(--primary-color)'; // Magenta
            activeButton.style.borderColor = 'var(--primary-color)';
        } else {
            activeButton.style.backgroundColor = 'var(--primary-color)'; // Magenta
            activeButton.style.borderColor = 'var(--primary-color)';
        }
    }

    function generateNotesChart() {
        console.log("generateNotesChart called.");
        const tables = document.querySelectorAll('.table-notes');
        console.log("Found tables:", tables.length); // Debug log
        const noteCounts = {};
        const allNotesRaw = Object.keys(noteMapping).sort((a, b) => noteMapping[b] - noteMapping[a]); // Tri par valeur GPA décroissante
        // Exclure A+ et F du graphique
        const allNotes = allNotesRaw.filter(note => note !== 'A+' && note !== 'F');

        tables.forEach(table => {
            const noteElement = table.querySelector('tr:last-child td:last-child');
            if (noteElement) {
                const rawNoteText = noteElement.textContent; // Log the raw text
                // Extraire la note réelle avant le statut de validation
                const noteMatch = rawNoteText.match(/^([A-D][+-]?|E|F|ABS|Disp)/);
                let noteTextForMapping = '';
                if (noteMatch && noteMatch[1]) {
                    noteTextForMapping = noteMatch[1].trim();
                } else {
                    noteTextForMapping = rawNoteText.trim(); // Fallback au cas où le format change
                }

                console.log(`Raw note text: '${rawNoteText}', Extracted note for mapping: '${noteTextForMapping}'`); // Debug log
                // Ignorer les notes vides ou '-' (non saisies)
                const normalized = noteTextForMapping.trim();
                if (!normalized || normalized === '-') {
                    return; // ne pas compter ni logguer
                }
                // Vérifier si la note est dans noteMapping avant de l'ajouter
                if (noteMapping.hasOwnProperty(normalized)) {
                    noteCounts[normalized] = (noteCounts[normalized] || 0) + 1;
                } else {
                    console.warn(`Note '${normalized}' not found in noteMapping.`);
                }
            }
        });

        const chartDiv = document.getElementById('notesChart');
        if (!chartDiv) {
            console.error("Error: #notesChart element not found.");
            return;
        }
        console.log("Chart Div:", chartDiv);
        chartDiv.innerHTML = ''; // Nettoyer le graphique précédent

        let maxCount = 0;
        for (const note in noteCounts) {
            if (noteCounts[note] > maxCount) {
                maxCount = noteCounts[note];
            }
        }
        console.log("Note Counts:", noteCounts);
        console.log("Max Count:", maxCount);

        const chartHeight = 170; // Hauteur maximale pour les barres (200px total - 30px pour les labels)
        const minBarHeight = 5; // Hauteur minimale en pixels pour les barres avec un count > 0

        allNotes.forEach(note => {
            const count = noteCounts[note] || 0;
            let barHeightPx = maxCount > 0 ? (count / maxCount) * chartHeight : 0;
            if (count > 0 && barHeightPx < minBarHeight) {
                barHeightPx = minBarHeight;
            }
            console.log(`Note: ${note}, Count: ${count}, MaxCount: ${maxCount}, BarHeightPx: ${barHeightPx}`); // Debug log

            const barContainer = document.createElement('div');
            barContainer.style.display = 'flex';
            barContainer.style.flexDirection = 'column';
            barContainer.style.alignItems = 'center';
            barContainer.style.margin = '0 5px';
            barContainer.style.height = '100%'; // Permettre au conteneur de barre de prendre toute la hauteur disponible
            barContainer.style.justifyContent = 'flex-end'; // Aligner les barres en bas

            const bar = document.createElement('div');
            bar.style.width = '20px';
            bar.style.height = `${barHeightPx}px`; // Utiliser des pixels pour la hauteur
            bar.style.backgroundColor = document.body.classList.contains('dark-mode') ? 'var(--primary-color)' : 'var(--primary-color)'; // Magenta
            bar.style.borderRadius = '3px';
            bar.style.transition = 'height 0.5s ease-out';
            bar.style.display = 'flex';
            bar.style.alignItems = 'flex-end';
            bar.style.justifyContent = 'center';
            bar.style.color = 'white';
            bar.style.fontWeight = 'bold';
            bar.textContent = count > 0 ? count : ''; // Afficher le nombre si > 0

            const label = document.createElement('span');
            label.textContent = note;
            label.style.marginTop = '5px';
            label.style.color = document.body.classList.contains('dark-mode') ? 'var(--dark-color)' : '#333';

            barContainer.appendChild(bar);
            barContainer.appendChild(label);
            chartDiv.appendChild(barContainer);
        });
    }

    function sortTables(order) {
        const notesContainer = document.querySelector('.text-center > div:last-child'); // Le conteneur des tables de notes
        if (!notesContainer) return;

        let sortedTables = [];

        if (order === 'validated') {
            sortedTables = originalTablesOrder.filter(item => item.validated);
            sortedTables = sortedTables.concat(originalTablesOrder.filter(item => !item.validated));
        } else if (order === 'nonValidated') {
            sortedTables = originalTablesOrder.filter(item => !item.validated);
            sortedTables = sortedTables.concat(originalTablesOrder.filter(item => item.validated));
        } else { // 'normal'
            sortedTables = originalTablesOrder;
        }

        // Supprimer toutes les tables existantes
        notesContainer.innerHTML = '';

        // Ajouter les tables triées
        sortedTables.forEach(item => {
            notesContainer.appendChild(item.table);
        });
    }

    // Fonction pour trier les tables par date
    function sortTablesByDate() {
        const notesContainer = document.querySelector('.text-center > div:last-child');
        if (!notesContainer) return;

        // Extraire la date de chaque table
        const tablesWithDates = originalTablesOrder.map(item => {
            let dateStr = '';
            let dateObj = null;
            try {
                // Chercher la date dans la table (généralement dans une cellule)
                const rows = item.table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    cells.forEach(cell => {
                        const text = cell.textContent.trim();
                        // Format date: DD/MM/YYYY ou DD-MM-YYYY
                        const dateMatch = text.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
                        if (dateMatch && !dateObj) {
                            const day = parseInt(dateMatch[1], 10);
                            const month = parseInt(dateMatch[2], 10) - 1;
                            const year = parseInt(dateMatch[3], 10);
                            dateObj = new Date(year, month, day);
                            dateStr = text;
                        }
                    });
                });
            } catch (e) {
                console.warn('Impossible d\'extraire la date:', e);
            }
            return { ...item, dateObj, dateStr };
        });

        // Trier par date (plus récent en premier)
        tablesWithDates.sort((a, b) => {
            if (!a.dateObj && !b.dateObj) return 0;
            if (!a.dateObj) return 1;
            if (!b.dateObj) return -1;
            return b.dateObj - a.dateObj; // Plus récent en premier
        });

        // Reconstruire le conteneur
        notesContainer.innerHTML = '';
        tablesWithDates.forEach(item => {
            notesContainer.appendChild(item.table);
        });
    }

    // Initialiser le simulateur de notes
    function initGradeSimulator() {
        const simModuleSelect = document.getElementById('simModuleSelect');
        const simGradeSelect = document.getElementById('simGradeSelect');
        const simCoeffInput = document.getElementById('simCoeffInput');
        const addSimGradeBtn = document.getElementById('addSimGrade');
        const simGradesList = document.getElementById('simGradesList');
        const simAverageDisplay = document.getElementById('simAverageDisplay');
        const simAverageValue = document.getElementById('simAverageValue');
        const gradeSimulatorContainer = document.getElementById('gradeSimulatorContainer');

        if (!simModuleSelect || !addSimGradeBtn) return;

        // Appliquer le style dark mode si nécessaire
        if (document.body.classList.contains('dark-mode')) {
            gradeSimulatorContainer.style.borderColor = '#555';
            simModuleSelect.style.backgroundColor = 'var(--dark-primary-color)';
            simModuleSelect.style.color = 'var(--dark-color)';
            simModuleSelect.style.borderColor = '#434343';
            simGradeSelect.style.backgroundColor = 'var(--dark-primary-color)';
            simGradeSelect.style.color = 'var(--dark-color)';
            simGradeSelect.style.borderColor = '#434343';
            simCoeffInput.style.backgroundColor = 'var(--dark-primary-color)';
            simCoeffInput.style.color = 'var(--dark-color)';
            simCoeffInput.style.borderColor = '#434343';
        }

        // Remplir le select des modules avec les matières disponibles
        const tables = document.querySelectorAll('.table-notes');
        const modules = [];
        tables.forEach((table, index) => {
            try {
                const evalNameElement = table.querySelector('th.col-5');
                const coeffElement = table.querySelector('tr:last-child td:nth-child(3)');
                let moduleName = evalNameElement ? evalNameElement.textContent.trim() : `Module ${index + 1}`;
                let coeff = coeffElement ? parseFloat(coeffElement.textContent.trim()) : 1;
                if (isNaN(coeff)) coeff = 1;
                modules.push({ name: moduleName, coeff, index });
            } catch (e) {
                modules.push({ name: `Module ${index + 1}`, coeff: 1, index });
            }
        });

        // Ajouter une option personnalisée
        const customOption = document.createElement('option');
        customOption.value = '__custom__';
        customOption.textContent = '📝 Nouvelle matière (personnalisée)';
        simModuleSelect.appendChild(customOption);

        modules.forEach((mod, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = mod.name;
            opt.dataset.coeff = mod.coeff;
            simModuleSelect.appendChild(opt);
        });

        // Mettre à jour le coefficient quand on change de module
        simModuleSelect.addEventListener('change', () => {
            const selected = simModuleSelect.options[simModuleSelect.selectedIndex];
            if (selected.dataset.coeff) {
                simCoeffInput.value = selected.dataset.coeff;
            } else {
                simCoeffInput.value = '1';
            }
        });

        // Ajouter une note simulée
        addSimGradeBtn.addEventListener('click', () => {
            const selectedOption = simModuleSelect.options[simModuleSelect.selectedIndex];
            let moduleName = selectedOption.textContent;
            if (selectedOption.value === '__custom__') {
                moduleName = prompt('Entrez le nom de la matière:');
                if (!moduleName) return;
            }
            const grade = simGradeSelect.value;
            const coeff = parseFloat(simCoeffInput.value) || 1;

            simulatedGrades.push({ moduleName, grade, coefficient: coeff });
            updateSimulatedGradesDisplay();
            calculateSimulatedAverage();
        });

        function updateSimulatedGradesDisplay() {
            simGradesList.innerHTML = '';
            if (simulatedGrades.length === 0) {
                simAverageDisplay.style.display = 'none';
                return;
            }

            simAverageDisplay.style.display = 'block';

            simulatedGrades.forEach((sim, idx) => {
                const item = document.createElement('div');
                item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-bottom: 5px; background: rgba(103, 126, 234, 0.2); border-radius: 5px; border-left: 3px solid #667eea;';
                item.innerHTML = `
                    <span><strong>${sim.moduleName}</strong> — Note: <strong>${sim.grade}</strong> (coeff: ${sim.coefficient})</span>
                    <button class="remove-sim-grade" data-idx="${idx}" style="background: #dc3545; color: white; border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer;">✕</button>
                `;
                simGradesList.appendChild(item);
            });

            // Event listeners pour supprimer
            simGradesList.querySelectorAll('.remove-sim-grade').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.target.dataset.idx, 10);
                    simulatedGrades.splice(idx, 1);
                    updateSimulatedGradesDisplay();
                    calculateSimulatedAverage();
                });
            });
        }

        function calculateSimulatedAverage() {
            // Calculer la moyenne réelle + simulée
            let totalGPA = 0;
            let totalCoeff = 0;

            // Notes réelles
            const tables = document.querySelectorAll('.table-notes');
            tables.forEach(table => {
                const noteElement = table.querySelector('tr:last-child td:last-child');
                const coeffElement = table.querySelector('tr:last-child td:nth-child(3)');

                if (noteElement && coeffElement) {
                    const noteTextRaw = noteElement.textContent.trim();
                    const noteText = noteTextRaw.split('\n')[0].split('(')[0].trim();
                    const coefficient = parseFloat(coeffElement.textContent.trim());

                    const isEmptyNote = noteText === '' || noteText === '-';
                    if (!isEmptyNote) {
                        const gpa = convertNoteToGPA(noteText);
                        if (gpa !== null && !isNaN(coefficient) && coefficient > 0) {
                            totalGPA += gpa * coefficient;
                            totalCoeff += coefficient;
                        }
                    }
                }
            });

            // Ajouter les notes simulées
            simulatedGrades.forEach(sim => {
                const gpa = convertNoteToGPA(sim.grade);
                if (gpa !== null && sim.coefficient > 0) {
                    totalGPA += gpa * sim.coefficient;
                    totalCoeff += sim.coefficient;
                }
            });

            const averageGPA = totalCoeff > 0 ? (totalGPA / totalCoeff).toFixed(2) : 'N/A';
            simAverageValue.textContent = averageGPA;
        }
    }

    // Exécuter le script après le chargement complet de la page
    window.addEventListener('load', () => {
        console.log("Igensia Enhancer: Page loaded, calculating and displaying summary.");
        calculateAndDisplaySummary();
    });
})();
