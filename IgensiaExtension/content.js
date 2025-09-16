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
        const tables = document.querySelectorAll('.table-notes');
        let totalGPA = 0;
        let totalCoeff = 0;
        let validatedModulesCount = 0;
        let totalModules = 0;

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
                    // Si le span est déjà là, juste mettre à jour le compteur
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

        const mainContainer = document.querySelector('.main-container');
        if (mainContainer) {
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
                summaryDiv.style.borderColor = '#434343'; // Utiliser une couleur de bordure adaptée au mode sombre
            } else {
                summaryDiv.style.backgroundColor = '#f9f9f9';
                summaryDiv.style.color = '#333';
                summaryDiv.style.borderColor = '#ccc';
            }

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
                    <input type="text" id="teacherSearchInput" placeholder="Rechercher par formateur" style="flex-grow: 1; padding: 8px; border-radius: 5px; border: 1px solid #ccc;">
                    <button id="resetSearchButton" class="igensia-enhancer-button">Réinitialiser</button>
                </div>
                <div id="notesChartContainer" style="display: none; margin-top: 20px; padding: 15px; border-radius: 8px;">
                    <h3>Répartition des notes</h3>
                    <div id="notesChart" style="width: 100%; height: 200px; display: flex; align-items: flex-end; justify-content: space-around;"></div>
                </div>
            `;

            // Appliquer les styles au conteneur du graphique
            const notesChartContainer = document.getElementById('notesChartContainer');
            const teacherSearchInput = document.getElementById('teacherSearchInput');
            const searchTeacherButton = document.getElementById('searchTeacherButton');
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

                // Styles par défaut pour les boutons
                if (document.body.classList.contains('dark-mode')) {
                    button.style.backgroundColor = 'var(--secondary-color)'; // Bleu violet
                    button.style.color = 'white';
                    button.style.borderColor = 'var(--secondary-color)';
                } else {
                    button.style.backgroundColor = 'var(--secondary-color)'; // Bleu violet
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
                    // Ajouter un petit délai pour s'assurer que le conteneur est visible et a une hauteur
                    setTimeout(() => {
                        console.log("Calling generateNotesChart after timeout.");
                        generateNotesChart();
                    }, 50);
                } else {
                    notesChartContainer.style.display = 'none';
                    toggleChartButton.textContent = 'Afficher Graphique';
                }
            });

            teacherSearchInput.addEventListener('input', filterTablesByTeacher); // Recherche en temps réel
            resetSearchButton.addEventListener('click', resetTableFilter);

            // Définir le bouton "Ordre Normal" comme actif par défaut
            setActiveButton(sortNormalButton);
        }
    }

    function filterTablesByTeacher() {
        const searchTerm = document.getElementById('teacherSearchInput').value.toLowerCase();
        const notesContainer = document.querySelector('.text-center > div:last-child');
        if (!notesContainer) return;

        originalTablesOrder.forEach(item => {
            const teacherElement = item.table.querySelector('th.col-4');
            if (teacherElement) {
                const teacherName = teacherElement.textContent.toLowerCase();
                if (teacherName.includes(searchTerm)) {
                    item.table.style.display = ''; // Afficher la table
                } else {
                    item.table.style.display = 'none'; // Masquer la table
                }
            } else {
                item.table.style.display = 'none'; // Masquer si pas de nom de formateur
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
