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
    let simulatedGrades = []; // { moduleName, grade, coefficient, isNew: true }

    // Variable pour stocker les notes existantes éditées (effacées au refresh)
    let editedGrades = {}; // { tableIndex: { originalGrade, newGrade, moduleName, coefficient } }

    // Avertissement avant de quitter si des notes simulées ou éditées existent
    window.addEventListener('beforeunload', (e) => {
        if (simulatedGrades.length > 0 || Object.keys(editedGrades).length > 0) {
            e.preventDefault();
            e.returnValue = 'Vous avez des notes simulées/éditées non sauvegardées. Êtes-vous sûr de vouloir quitter ?';
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

            tables.forEach((table, tableIndex) => {
                const noteElement = table.querySelector('tr:last-child td:last-child');
                const coeffElement = table.querySelector('tr:last-child td:nth-child(3)');
                const evalNameElement = table.querySelector('th.col-5');

                if (noteElement && coeffElement) {
                    // Utiliser le texte original sauvegardé ou le récupérer et le sauvegarder
                    let noteText;
                    if (noteElement.dataset.originalText) {
                        noteText = noteElement.dataset.originalText;
                    } else {
                        const noteTextRaw = noteElement.textContent.trim();
                        // Si le texte contient déjà nos ajouts (pollution), on essaie de nettoyer
                        // Heuristique: prendre ce qui est avant '(' ou '➕' ou '✏️'
                        let rawClean = noteTextRaw.split('\n')[0].trim();
                        if (rawClean.includes('(')) rawClean = rawClean.split('(')[0].trim();
                        if (rawClean.includes('➕')) rawClean = rawClean.replace('➕', '').trim();
                        // Note: si la note est juste '-', on garde '-'
                        noteText = rawClean;

                        // Sauvegarder pour la prochaine fois
                        noteElement.dataset.originalText = noteText;
                    }
                    const coefficient = parseFloat(coeffElement.textContent.trim());
                    const moduleName = evalNameElement ? evalNameElement.textContent.trim() : `Module ${tableIndex + 1}`;

                    // Vérifier si cette note a été éditée
                    const isEdited = editedGrades.hasOwnProperty(tableIndex);
                    const displayNote = isEdited ? editedGrades[tableIndex].newGrade : noteText;
                    const gpa = convertNoteToGPA(displayNote);

                    // Si la note est '-' ou vide, considérer qu'elle n'est pas encore saisie
                    const isEmptyNote = displayNote === '' || displayNote === '-';

                    if (!isEmptyNote) {
                        totalModules++;
                        // Éviter d'ajouter le span si déjà présent
                        if (!noteElement.querySelector('.note-status-span')) {
                            // Ajouter le bouton d'édition
                            const editBtn = document.createElement('button');
                            editBtn.className = 'edit-note-btn';
                            editBtn.innerHTML = '✏️';
                            editBtn.title = 'Modifier cette note (simulation)';
                            editBtn.style.cssText = 'display: none; margin-left: 8px; background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.7; transition: opacity 0.2s;';
                            editBtn.dataset.tableIndex = tableIndex;
                            editBtn.dataset.moduleName = moduleName;
                            editBtn.dataset.originalNote = noteText;
                            editBtn.dataset.coefficient = coefficient;

                            editBtn.addEventListener('mouseenter', () => editBtn.style.opacity = '1');
                            editBtn.addEventListener('mouseleave', () => editBtn.style.opacity = '0.7');

                            // Créer le conteneur pour la note et le statut
                            const noteDisplay = document.createElement('span');
                            noteDisplay.className = 'note-display';
                            noteDisplay.textContent = displayNote;
                            if (isEdited) {
                                noteDisplay.style.cssText = 'color: #667eea; font-weight: bold;';
                                noteDisplay.title = `Note originale: ${noteText}`;
                            }

                            const statusSpan = document.createElement('span');
                            statusSpan.className = 'note-status-span';
                            if (isModuleValidated(displayNote)) {
                                validatedModulesCount++;
                                statusSpan.style.cssText = 'color: green; font-weight: bold; margin-left: 5px;';
                                statusSpan.textContent = isEdited ? '(Validé - Simulé)' : '(Validé)';
                            } else {
                                statusSpan.style.cssText = 'color: red; font-weight: bold; margin-left: 5px;';
                                statusSpan.textContent = isEdited ? '(Non validé - Simulé)' : '(Non validé)';
                            }

                            // Remplacer le contenu de la cellule
                            noteElement.innerHTML = '';
                            noteElement.appendChild(noteDisplay);
                            noteElement.appendChild(statusSpan);
                            noteElement.appendChild(editBtn);
                        } else {
                            // Mettre à jour les éléments existants
                            const existingNoteDisplay = noteElement.querySelector('.note-display');
                            const existingStatus = noteElement.querySelector('.note-status-span');

                            if (existingNoteDisplay) {
                                existingNoteDisplay.textContent = displayNote;
                                if (isEdited) {
                                    existingNoteDisplay.style.cssText = 'color: #667eea; font-weight: bold;';
                                    existingNoteDisplay.title = `Note originale: ${noteText}`;
                                } else {
                                    existingNoteDisplay.style.cssText = '';
                                    existingNoteDisplay.removeAttribute('title');
                                }
                            }

                            if (existingStatus) {
                                if (isModuleValidated(displayNote)) {
                                    validatedModulesCount++;
                                    existingStatus.style.cssText = 'color: green; font-weight: bold; margin-left: 5px;';
                                    existingStatus.textContent = isEdited ? '(Validé - Simulé)' : '(Validé)';
                                } else {
                                    existingStatus.style.cssText = 'color: red; font-weight: bold; margin-left: 5px;';
                                    existingStatus.textContent = isEdited ? '(Non validé - Simulé)' : '(Non validé)';
                                }
                            } else {
                                if (isModuleValidated(displayNote)) validatedModulesCount++;
                            }
                        }

                        if (gpa !== null && !isNaN(coefficient) && coefficient > 0) {
                            totalGPA += gpa * coefficient;
                            totalCoeff += coefficient;
                        }
                    } else {
                        // Si note vide, ajouter quand même le bouton pour simuler
                        if (!noteElement.querySelector('.edit-note-btn')) {
                            const editBtn = document.createElement('button');
                            editBtn.className = 'edit-note-btn';
                            editBtn.innerHTML = '➕';
                            editBtn.title = 'Ajouter une note simulée';
                            editBtn.style.cssText = 'display: none; margin-left: 8px; background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.7;';
                            editBtn.dataset.tableIndex = tableIndex;
                            editBtn.dataset.moduleName = moduleName;
                            editBtn.dataset.originalNote = '-';
                            editBtn.dataset.coefficient = coefficient || 1;
                            noteElement.appendChild(editBtn);
                        }
                    }
                }
            });

            const averageGPA = totalCoeff > 0 ? (totalGPA / totalCoeff).toFixed(2) : 'N/A';
            const validatedPercentage = totalModules > 0 ? ((validatedModulesCount / totalModules) * 100).toFixed(2) : 'N/A';

            // Récupérer l'objectif sauvegardé
            let savedObjective = '3.0';
            try { savedObjective = localStorage.getItem('igsGpaObjective') || '3.0'; } catch (e) { }
            const objectiveNum = parseFloat(savedObjective);
            const currentGPA = parseFloat(averageGPA) || 0;
            const gpaProgress = objectiveNum > 0 ? Math.min((currentGPA / objectiveNum) * 100, 100) : 0;
            const gpaDiff = (currentGPA - objectiveNum).toFixed(2);
            const gpaStatus = gpaDiff >= 0 ? `✅ +${gpaDiff}` : `⚠️ ${gpaDiff}`;
            const progressColor = gpaDiff >= 0 ? '#28a745' : (gpaDiff >= -0.5 ? '#ffc107' : '#dc3545');

            summaryDiv.innerHTML = `
                <p><strong>Moyenne pondérée (GPA) : ${averageGPA}</strong></p>
                <p><strong>Modules validés : ${validatedModulesCount} / ${totalModules} (${validatedPercentage}%)</strong></p>
                <div id="gpaObjectiveContainer" style="margin-top: 10px; padding: 12px; border-radius: 8px; background: linear-gradient(135deg, rgba(102,126,234,0.1) 0%, rgba(118,75,162,0.1) 100%); border: 1px solid rgba(102,126,234,0.3);">
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-weight: bold;">🎯 Objectif GPA :</span>
                        <input type="number" id="gpaObjectiveInput" value="${savedObjective}" min="0" max="4" step="0.1" style="width: 70px; padding: 5px; border-radius: 5px; border: 1px solid #ccc; text-align: center;">
                        <span id="gpaStatusDisplay" style="font-weight: bold; color: ${progressColor};">${gpaStatus}</span>
                    </div>
                    <div style="margin-top: 10px; background: #e0e0e0; border-radius: 10px; height: 20px; overflow: hidden;">
                        <div id="gpaProgressBar" style="height: 100%; width: ${gpaProgress}%; background: ${progressColor}; transition: width 0.3s, background 0.3s; border-radius: 10px;"></div>
                    </div>
                    <p style="font-size: 11px; margin-top: 5px; opacity: 0.7;">Progression vers votre objectif de moyenne</p>
                </div>
                <div id="sort-buttons" style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 5px;">
                    <button id="sortValidated" class="igensia-enhancer-button">Trier par Validés</button>
                    <button id="sortNonValidated" class="igensia-enhancer-button">Trier par Non Validés</button>
                    <button id="sortByDate" class="igensia-enhancer-button">Trier par Date</button>
                    <button id="sortNormal" class="igensia-enhancer-button">Ordre Normal</button>
                    <button id="toggleChart" class="igensia-enhancer-button">Afficher Graphique</button>
                    <button id="exportPdfBtn" class="igensia-enhancer-button" style="background-color: #6c757d !important;">📄 Export PDF</button>
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
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h3 style="margin: 0;">📊 Mode Simulation</h3>
                        <label style="display: flex; align-items: center; cursor: pointer; gap: 8px;">
                            <span style="font-size: 12px; opacity: 0.8;">Activer</span>
                            <div style="position: relative; width: 44px; height: 24px;">
                                <input type="checkbox" id="simulationModeToggle" style="opacity: 0; width: 0; height: 0;" ${localStorage.getItem('igsSimulationMode') === '1' ? 'checked' : ''}>
                                <span id="toggleSlider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${localStorage.getItem('igsSimulationMode') === '1' ? '#28a745' : '#ccc'}; transition: 0.3s; border-radius: 24px;"></span>
                                <span id="toggleKnob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%; transform: ${localStorage.getItem('igsSimulationMode') === '1' ? 'translateX(20px)' : 'translateX(0)'};"></span>
                            </div>
                        </label>
                    </div>
                    <div id="simulatorContent" style="display: ${localStorage.getItem('igsSimulationMode') === '1' ? 'block' : 'none'};">
                        <p style="font-size: 12px; opacity: 0.7; margin-bottom: 10px;">Ajoutez des notes hypothétiques ou modifiez les existantes. Les modifications disparaîtront au rafraîchissement.</p>
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

            // Export PDF
            const exportPdfBtn = document.getElementById('exportPdfBtn');
            exportPdfBtn.addEventListener('click', exportToPdf);

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

            // Event listener pour l'objectif GPA
            const gpaObjectiveInput = document.getElementById('gpaObjectiveInput');
            gpaObjectiveInput.addEventListener('change', () => {
                const newObjective = gpaObjectiveInput.value;
                try { localStorage.setItem('igsGpaObjective', newObjective); } catch (e) { }
                // Mettre à jour l'affichage
                updateGpaObjectiveDisplay(parseFloat(averageGPA) || 0, parseFloat(newObjective) || 3);
            });

            // Ne pas afficher ni récupérer les absences sur la page des notes.

            // Définir le bouton "Ordre Normal" comme actif par défaut
            setActiveButton(sortNormalButton);

            // Initialiser le simulateur de notes
            initGradeSimulator();

            // Toggle pour activer/désactiver le mode simulation
            const simulationToggle = document.getElementById('simulationModeToggle');
            const simulatorContent = document.getElementById('simulatorContent');
            const toggleSlider = document.getElementById('toggleSlider');
            const toggleKnob = document.getElementById('toggleKnob');

            simulationToggle.addEventListener('change', () => {
                const isEnabled = simulationToggle.checked;
                try { localStorage.setItem('igsSimulationMode', isEnabled ? '1' : '0'); } catch (e) { }
                simulatorContent.style.display = isEnabled ? 'block' : 'none';

                // Style du toggle
                toggleSlider.style.backgroundColor = isEnabled ? '#28a745' : '#ccc';
                toggleKnob.style.transform = isEnabled ? 'translateX(20px)' : 'translateX(0)';

                // Afficher/cacher les boutons d'édition sur les notes existantes
                document.querySelectorAll('.edit-note-btn').forEach(btn => {
                    btn.style.display = isEnabled ? 'inline-block' : 'none';
                });
            });

            // Initialiser les boutons d'édition des notes existantes (cachés par défaut sauf si le mode est activé)
            if (localStorage.getItem('igsSimulationMode') === '1') {
                setTimeout(() => {
                    document.querySelectorAll('.edit-note-btn').forEach(btn => btn.style.display = 'inline-block');
                }, 100);
            }
            initEditButtons();
        } else if (absTables && absTables.length > 0) {
            // Page d'absences: afficher uniquement le résumé des absences + recherche
            summaryDiv.innerHTML = `
                <div id="absencesContainer" style="margin-top: 10px; padding: 10px; border-radius: 8px;">
                    <h3>Absences</h3>
                    <div style="display:flex; gap:8px; margin-top:8px; flex-wrap: wrap;">
                    <div style="display:flex; gap:8px; margin-top:8px; flex-wrap: wrap;">
                        <input type="text" id="absenceSearchInput" placeholder="Rechercher par matière ou action" style="flex:1; padding:6px; border-radius:4px; border:1px solid #ccc; min-width: 200px; color: #333;">
                        <button id="resetAbsenceSearch" class="igensia-enhancer-button" style="color: #fff; background-color: #6c757d; border-color: #6c757d;">Réinitialiser</button>
                    </div>
                    <p id="absencesSummary" style="margin-top: 10px;"></p>
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
            let totalJustifieHours = 0.0;
            let totalInjustifieHours = 0.0;
            let totalRetardsHours = 0.0;

            const parseNum = s => {
                if (!s) return 0;
                const n = parseFloat(s.replace(',', '.').match(/[-0-9.,]+/)?.[0] || '0');
                return isNaN(n) ? 0 : n;
            };

            tables.forEach(table => {
                // Si on travaille sur le document courant (useDoc === document), filtrer les tables cachées
                if (useDoc === document && table.style && table.style.display === 'none') return;

                // Trouver l'index de la colonne "Nb Heure" (souvent la dernière, header "Nb Heure")
                let nbHeureIndex = -1;
                const headers = table.querySelectorAll('th');
                headers.forEach((th, idx) => {
                    if (th.textContent.toLowerCase().includes('nb heure')) nbHeureIndex = idx;
                });

                const rows = Array.from(table.querySelectorAll('tr'));
                rows.forEach(r => {
                    const cells = r.querySelectorAll('td');
                    if (!cells || cells.length === 0) return; // Skip headers/footers

                    const rowText = r.textContent.toLowerCase();
                    let duration = 0;

                    if (nbHeureIndex !== -1 && cells[nbHeureIndex]) {
                        duration = parseNum(cells[nbHeureIndex].textContent);
                    } else if (cells.length > 2) {
                        // Fallback: essayer la dernière colonne
                        duration = parseNum(cells[cells.length - 1].textContent);
                    }

                    if (rowText.includes('retard') || rowText.includes('exclusion')) {
                        totalRetardsHours += duration;
                    } else {
                        // C'est une absence
                        if (rowText.includes('non justifi') || rowText.includes('injustifi')) {
                            totalInjustifieHours += duration;
                        } else if (rowText.includes('justifi')) {
                            totalJustifieHours += duration;
                        } else {
                            // Par défaut injustifiée
                            totalInjustifieHours += duration;
                        }
                    }
                });
            });

            const formatHours = (h) => {
                const hours = Math.floor(h);
                const minutes = Math.round((h - hours) * 60);
                return minutes > 0 ? `${hours}h${minutes < 10 ? '0' : ''}${minutes}` : `${hours}h`;
            };

            const totalHours = totalJustifieHours + totalInjustifieHours + totalRetardsHours;

            absencesSummaryEl.innerHTML = `
                <div style="display: flex; gap: 15px; flex-wrap: wrap; font-weight: 500;">
                    <span style="color: #d9534f;">❌ Non justifiées: ${formatHours(totalInjustifieHours)}</span>
                    <span style="color: #5cb85c;">✅ Justifiées: ${formatHours(totalJustifieHours)}</span>
                    <span style="color: #f0ad4e;">⏱️ Retards: ${formatHours(totalRetardsHours)}</span>
                    <span style="color: #0275d8; font-weight: bold;">📊 Total Heures: ${formatHours(totalHours)}</span>
                </div>
            `;
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

    // Initialiser les boutons d'édition des notes existantes
    function initEditButtons() {
        // Créer le modal d'édition s'il n'existe pas
        if (!document.getElementById('editNoteModal')) {
            const modal = document.createElement('div');
            modal.id = 'editNoteModal';
            modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; justify-content: center; align-items: center;';
            modal.innerHTML = `
                <div style="background: ${document.body.classList.contains('dark-mode') ? '#2d2d2d' : 'white'}; padding: 25px; border-radius: 10px; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <h3 style="margin-top: 0; color: ${document.body.classList.contains('dark-mode') ? '#fff' : '#333'};">✏️ Modifier la note</h3>
                    <p id="editNoteModuleName" style="font-weight: bold; color: #667eea;"></p>
                    <p style="font-size: 12px; opacity: 0.7; color: ${document.body.classList.contains('dark-mode') ? '#ccc' : '#666'};">Note originale: <span id="editNoteOriginal"></span></p>
                    <div style="margin: 15px 0;">
                        <label style="display: block; margin-bottom: 5px; color: ${document.body.classList.contains('dark-mode') ? '#fff' : '#333'};">Nouvelle note :</label>
                        <select id="editNoteSelect" style="width: 100%; padding: 10px; border-radius: 5px; border: 1px solid #ccc; background: ${document.body.classList.contains('dark-mode') ? '#1a1a1a' : '#fff'}; color: ${document.body.classList.contains('dark-mode') ? '#fff' : '#333'};">
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
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button id="editNoteCancel" style="padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; background: #6c757d; color: white;">Annuler</button>
                        <button id="editNoteReset" style="padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; background: #dc3545; color: white; display: none;">Réinitialiser</button>
                        <button id="editNoteSave" style="padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; background: #667eea; color: white;">Appliquer</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Gérer les clics en dehors du modal pour fermer
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });

            document.getElementById('editNoteCancel').addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }

        // Ajouter les event listeners aux boutons d'édition
        document.querySelectorAll('.edit-note-btn:not(.js-edit-init)').forEach(btn => {
            btn.classList.add('js-edit-init');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tableIndex = parseInt(btn.dataset.tableIndex, 10);
                const moduleName = btn.dataset.moduleName;
                const originalNote = btn.dataset.originalNote;
                const coefficient = parseFloat(btn.dataset.coefficient);

                const modal = document.getElementById('editNoteModal');
                document.getElementById('editNoteModuleName').textContent = moduleName;
                document.getElementById('editNoteOriginal').textContent = originalNote === '-' ? 'Aucune' : originalNote;

                const select = document.getElementById('editNoteSelect');
                const resetBtn = document.getElementById('editNoteReset');

                // Sélectionner la note actuelle (éditée ou originale)
                const currentEdit = editedGrades[tableIndex];
                if (currentEdit) {
                    select.value = currentEdit.newGrade;
                    resetBtn.style.display = 'inline-block';
                } else {
                    // Essayer de sélectionner la note originale
                    const noteMatch = originalNote.match(/^([A-D][+-]?|E)/);
                    if (noteMatch) {
                        select.value = noteMatch[1];
                    } else {
                        select.value = 'B'; // Valeur par défaut
                    }
                    resetBtn.style.display = 'none';
                }

                // Configure le bouton de sauvegarde
                const saveBtn = document.getElementById('editNoteSave');
                saveBtn.onclick = () => {
                    const newGrade = select.value;
                    editedGrades[tableIndex] = {
                        originalGrade: originalNote,
                        newGrade: newGrade,
                        moduleName: moduleName,
                        coefficient: coefficient
                    };
                    modal.style.display = 'none';
                    // Recalculer et rafraîchir l'affichage
                    refreshNotesDisplay();
                };

                // Configure le bouton de réinitialisation
                resetBtn.onclick = () => {
                    delete editedGrades[tableIndex];
                    modal.style.display = 'none';
                    refreshNotesDisplay();
                };

                modal.style.display = 'flex';
            });
        });
    }

    // Rafraîchir l'affichage des notes après édition
    function refreshNotesDisplay() {
        // Re-exécuter le calcul et l'affichage
        const existingSummary = document.querySelector('.igensia-enhancer-summary');
        if (existingSummary) {
            existingSummary.remove();
        }
        calculateAndDisplaySummary();
    }

    // Mettre à jour l'affichage de l'objectif GPA en temps réel
    function updateGpaObjectiveDisplay(currentGPA, objective) {
        const statusDisplay = document.getElementById('gpaStatusDisplay');
        const progressBar = document.getElementById('gpaProgressBar');
        if (!statusDisplay || !progressBar) return;

        const gpaProgress = objective > 0 ? Math.min((currentGPA / objective) * 100, 100) : 0;
        const gpaDiff = (currentGPA - objective).toFixed(2);
        const gpaStatus = gpaDiff >= 0 ? `✅ +${gpaDiff}` : `⚠️ ${gpaDiff}`;
        const progressColor = gpaDiff >= 0 ? '#28a745' : (gpaDiff >= -0.5 ? '#ffc107' : '#dc3545');

        statusDisplay.textContent = gpaStatus;
        statusDisplay.style.color = progressColor;
        progressBar.style.width = `${gpaProgress}%`;
        progressBar.style.background = progressColor;
    }

    // Fonction d'export PDF
    function exportToPdf() {
        const tables = document.querySelectorAll('.table-notes');
        const summaryDiv = document.querySelector('.igensia-enhancer-summary');

        // Récupérer les infos
        const gpaText = summaryDiv.querySelector('p strong')?.textContent || 'N/A';
        const modulesText = summaryDiv.querySelectorAll('p strong')[1]?.textContent || 'N/A';
        const date = new Date().toLocaleDateString('fr-FR');

        // Collecter les données des notes
        let notesData = [];
        tables.forEach((table, index) => {
            const evalName = table.querySelector('th.col-5')?.textContent?.trim() || `Évaluation ${index + 1}`;
            const noteElement = table.querySelector('tr:last-child td:last-child');
            const coeffElement = table.querySelector('tr:last-child td:nth-child(3)');
            const dateElement = table.querySelector('tr:nth-child(2) td:nth-child(2)');

            let noteText = noteElement?.textContent?.trim()?.split('\n')[0]?.trim() || '-';
            const noteMatch = noteText.match(/^([A-D][+-]?|E|F|ABS|Disp|-)/);
            const note = noteMatch ? noteMatch[1] : '-';
            const coeff = coeffElement?.textContent?.trim() || '1';
            const evalDate = dateElement?.textContent?.trim() || '';

            notesData.push({ evalName, note, coeff, evalDate });
        });

        // Créer le HTML pour l'impression
        const printContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Relevé de Notes - Igensia</title>
    <style>
        * { font-family: 'Segoe UI', Arial, sans-serif; }
        body { padding: 40px; max-width: 800px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #667eea; padding-bottom: 20px; }
        .header h1 { color: #667eea; margin: 0; font-size: 24px; }
        .header p { color: #666; margin: 5px 0; }
        .summary { background: linear-gradient(135deg, rgba(102,126,234,0.1) 0%, rgba(118,75,162,0.1) 100%); 
                   padding: 20px; border-radius: 10px; margin-bottom: 30px; }
        .summary h2 { margin: 0 0 10px 0; color: #333; font-size: 18px; }
        .summary p { margin: 5px 0; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: #667eea; color: white; padding: 12px 8px; text-align: left; font-size: 12px; }
        td { padding: 10px 8px; border-bottom: 1px solid #eee; font-size: 12px; }
        tr:nth-child(even) { background: #f9f9f9; }
        .note { font-weight: bold; text-align: center; }
        .note-pass { color: #28a745; }
        .note-fail { color: #dc3545; }
        .footer { margin-top: 40px; text-align: center; color: #999; font-size: 11px; }
        @media print { body { padding: 20px; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>📚 Relevé de Notes</h1>
        <p>Généré le ${date} par Igensia Enhancer</p>
    </div>
    <div class="summary">
        <h2>Résumé</h2>
        <p><strong>${gpaText}</strong></p>
        <p><strong>${modulesText}</strong></p>
    </div>
    <table>
        <thead>
            <tr>
                <th style="width: 50%">Évaluation</th>
                <th style="width: 20%">Date</th>
                <th style="width: 15%">Coeff</th>
                <th style="width: 15%">Note</th>
            </tr>
        </thead>
        <tbody>
            ${notesData.map(item => `
                <tr>
                    <td>${item.evalName}</td>
                    <td>${item.evalDate}</td>
                    <td style="text-align: center;">${item.coeff}</td>
                    <td class="note ${['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C'].includes(item.note) ? 'note-pass' : 'note-fail'}">${item.note}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    <div class="footer">
        <p>Document généré automatiquement - Igensia Enhancer Extension</p>
    </div>
</body>
</html>`;

        // Ouvrir une nouvelle fenêtre pour l'impression
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();

        // Imprimer après chargement
        printWindow.onload = () => {
            printWindow.print();
        };
    }

    // Générer le graphique des absences
    function generateAbsenceChart() {
        const absenceChart = document.getElementById('absenceChart');
        const absenceStats = document.getElementById('absenceStats');
        if (!absenceChart || !absenceStats) return;

        const absTables = document.querySelectorAll('.table-absences');

        // Collecter les données d'absences
        let absencesByMonth = {};
        let absencesByType = { 'Non justifiée': 0, 'Justifiée': 0, 'En attente': 0 };
        let totalAbsences = 0;
        let totalHours = 0;

        absTables.forEach(table => {
            try {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        // Chercher une date et un statut
                        const dateMatch = row.textContent.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                        if (dateMatch) {
                            const month = parseInt(dateMatch[2], 10);
                            const year = dateMatch[3];
                            const monthKey = `${month}/${year}`;
                            absencesByMonth[monthKey] = (absencesByMonth[monthKey] || 0) + 1;
                            totalAbsences++;
                        }

                        // Calculer les heures si disponible
                        const hoursMatch = row.textContent.match(/(\d+(?:[.,]\d+)?)\s*h/i);
                        if (hoursMatch) {
                            totalHours += parseFloat(hoursMatch[1].replace(',', '.'));
                        }

                        // Classifier par type
                        const rowText = row.textContent.toLowerCase();
                        if (rowText.includes('justifi') && !rowText.includes('non')) {
                            absencesByType['Justifiée']++;
                        } else if (rowText.includes('non justifi') || rowText.includes('non-justifi')) {
                            absencesByType['Non justifiée']++;
                        } else if (rowText.includes('attente')) {
                            absencesByType['En attente']++;
                        }
                    }
                });
            } catch (e) {
                console.warn('Erreur parsing absence:', e);
            }
        });

        // Générer le graphique par mois
        const months = Object.keys(absencesByMonth).sort((a, b) => {
            const [m1, y1] = a.split('/').map(Number);
            const [m2, y2] = b.split('/').map(Number);
            return (y1 * 12 + m1) - (y2 * 12 + m2);
        });

        const maxCount = Math.max(...Object.values(absencesByMonth), 1);
        const isDarkMode = document.body.classList.contains('dark-mode');
        const monthNames = ['', 'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

        if (months.length === 0) {
            absenceChart.innerHTML = '<p style="text-align:center; opacity:0.7;">Aucune absence trouvée</p>';
        } else {
            absenceChart.innerHTML = months.map(monthKey => {
                const count = absencesByMonth[monthKey];
                const heightPercent = (count / maxCount) * 100;
                const [month, year] = monthKey.split('/');
                const label = `${monthNames[parseInt(month)]} ${year.slice(2)}`;
                return `
                    <div style="display: flex; flex-direction: column; align-items: center; flex: 1; max-width: 60px;">
                        <span style="font-size: 11px; margin-bottom: 5px; font-weight: bold;">${count}</span>
                        <div style="width: 30px; height: ${heightPercent}%; min-height: 5px; background: linear-gradient(180deg, #dc3545 0%, #c82333 100%); border-radius: 4px 4px 0 0; transition: height 0.3s;"></div>
                        <span style="font-size: 10px; margin-top: 5px; opacity: 0.8;">${label}</span>
                    </div>
                `;
            }).join('');
        }

        // Afficher les statistiques
        const statsHtml = `
            <div style="padding: 10px; background: rgba(220,53,69,0.1); border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #dc3545;">${totalAbsences}</div>
                <div style="font-size: 11px; opacity: 0.8;">Absences</div>
            </div>
            <div style="padding: 10px; background: rgba(40,167,69,0.1); border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #28a745;">${absencesByType['Justifiée']}</div>
                <div style="font-size: 11px; opacity: 0.8;">Justifiées</div>
            </div>
            <div style="padding: 10px; background: rgba(255,193,7,0.1); border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #ffc107;">${absencesByType['Non justifiée']}</div>
                <div style="font-size: 11px; opacity: 0.8;">Non justifiées</div>
            </div>
            <div style="padding: 10px; background: rgba(108,117,125,0.1); border-radius: 8px; text-align: center;">
                <div style="font-size: 24px; font-weight: bold; color: #6c757d;">${totalHours.toFixed(1)}h</div>
                <div style="font-size: 11px; opacity: 0.8;">Total heures</div>
            </div>
        `;
        absenceStats.innerHTML = statsHtml;
    }

    // Exécuter le script après le chargement complet de la page
    window.addEventListener('load', () => {
        console.log("Igensia Enhancer: Page loaded, calculating and displaying summary.");
        calculateAndDisplaySummary();
    });
})();
