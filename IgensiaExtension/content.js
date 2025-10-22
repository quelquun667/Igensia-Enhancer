(function() {
    console.log("Igensia Enhancer: Content script loaded.");

    const noteMapping = {
        "A+": 4.0, "A": 4.0, "A-": 3.7,
        "B+": 3.3, "B": 3.0, "B-": 2.7,
        "C+": 2.3, "C": 2.0, "C-": 1.7,
        "D+": 1.3, "D": 1.0, "D-": 0.7,
        "E": 0.0, "F": 0.0, "ABS": 0.0, "Disp": 0.0
    };

    const passingGrades = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C"];

    function convertNoteToGPA(note) {
        return noteMapping[note.trim()] !== undefined ? noteMapping[note.trim()] : null;
    }

    function isModuleValidated(noteText) {
        return passingGrades.includes(noteText.trim());
    }

    let originalTablesOrder = []; // Pour stocker l'ordre original des tables

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
                    const noteText = noteElement.textContent.trim();
                    const coefficient = parseFloat(coeffElement.textContent.trim());

                    const gpa = convertNoteToGPA(noteText);

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
                    <button id="sortNormal" class="igensia-enhancer-button">Ordre Normal</button>
                    <button id="toggleChart" class="igensia-enhancer-button">Afficher Graphique</button>
                </div>
                <div id="search-container" style="margin-top: 10px; display: flex; gap: 5px;">
                    <input type="text" id="teacherSearchInput" placeholder="Rechercher par formateur ou évaluation" style="flex-grow: 1; padding: 8px; border-radius: 5px; border: 1px solid #ccc;">
                    <button id="resetSearchButton" class="igensia-enhancer-button">Réinitialiser</button>
                </div>
                <div id="notesChartContainer" style="display: none; margin-top: 20px; padding: 15px; border-radius: 8px;">
                    <h3>Répartition des notes</h3>
                    <div id="notesChart" style="width: 100%; height: 200px; display: flex; align-items: flex-end; justify-content: space-around;"></div>
                </div>
                <div id="absencesContainer" style="margin-top: 10px; padding: 10px; border-radius: 8px;">
                    <h3>Absences</h3>
                    <p id="absencesSummary">Chargement des absences...</p>
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

            // Lancer la récupération des absences (utile aussi sur la page notes)
            fetchAndDisplayAbsences();

            // Définir le bouton "Ordre Normal" comme actif par défaut
            setActiveButton(sortNormalButton);
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
            fetchAndDisplayAbsences();
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
                const resp = await fetch(ABSENCES_URL, { credentials: 'include' });
                if (!resp.ok) {
                    absencesSummaryEl.textContent = `Erreur lors de la récupération des absences: ${resp.status}`;
                    return;
                }
                const text = await resp.text();
                const parser = new DOMParser();
                useDoc = parser.parseFromString(text, 'text/html');
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

        originalTablesOrder.forEach(item => {
            const teacherElement = item.table.querySelector('th.col-4'); // Nom du formateur
            const evalNameElement = item.table.querySelector('th.col-5'); // Nom de l'évaluation (à vérifier si c'est le bon sélecteur)

            let match = false;
            if (teacherElement) {
                const teacherName = teacherElement.textContent.toLowerCase();
                if (teacherName.includes(searchTerm)) {
                    match = true;
                }
            }
            if (!match && evalNameElement) { // Si pas de correspondance avec le formateur, vérifier le nom de l'évaluation
                const evalName = evalNameElement.textContent.toLowerCase();
                if (evalName.includes(searchTerm)) {
                    match = true;
                }
            }

            if (match) {
                item.table.style.display = ''; // Afficher la table
            } else {
                item.table.style.display = 'none'; // Masquer la table
            }
        });
    }

    function resetTableFilter() {
        document.getElementById('teacherSearchInput').value = '';
        const notesContainer = document.querySelector('.text-center > div:last-child');
        if (!notesContainer) return;

        originalTablesOrder.forEach(item => {
            item.table.style.display = ''; // Afficher toutes les tables
        });
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
        const allNotes = Object.keys(noteMapping).sort((a, b) => noteMapping[b] - noteMapping[a]); // Tri par valeur GPA décroissante

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
                // Vérifier si la note est dans noteMapping avant de l'ajouter
                if (noteMapping.hasOwnProperty(noteTextForMapping)) {
                    noteCounts[noteTextForMapping] = (noteCounts[noteTextForMapping] || 0) + 1;
                } else {
                    console.warn(`Note '${noteTextForMapping}' not found in noteMapping.`);
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

    // Exécuter le script après le chargement complet de la page
    window.addEventListener('load', () => {
        console.log("Igensia Enhancer: Page loaded, calculating and displaying summary.");
        calculateAndDisplaySummary();
    });
})();
