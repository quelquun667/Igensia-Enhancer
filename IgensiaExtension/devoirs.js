document.addEventListener('DOMContentLoaded', () => {
    const devoirForm = document.getElementById('devoir-form');
    const devoirTitleInput = document.getElementById('devoir-title');
    const devoirDescriptionInput = document.getElementById('devoir-description');
    const devoirDueDateInput = document.getElementById('devoir-due-date');
    const devoirList = document.getElementById('devoir-list');

    let devoirs = [];

    // Charger les devoirs depuis le stockage local
    function loadDevoirs() {
        chrome.storage.local.get(['devoirs'], (result) => {
            if (result.devoirs) {
                devoirs = result.devoirs;
                renderDevoirs();
            }
        });
    }

    // Sauvegarder les devoirs dans le stockage local
    function saveDevoirs() {
        chrome.storage.local.set({ devoirs: devoirs });
    }

    // Afficher les devoirs
    function renderDevoirs() {
        devoirList.innerHTML = '';
        devoirs.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)); // Trier par date d'échéance

        devoirs.forEach(devoir => {
            const devoirItem = document.createElement('div');
            devoirItem.className = `devoir-item ${devoir.completed ? 'completed' : ''}`;
            devoirItem.dataset.id = devoir.id;

            devoirItem.innerHTML = `
                <h3>${devoir.title}</h3>
                <p>${devoir.description}</p>
                <p class="due-date">Échéance : ${devoir.dueDate || 'Non spécifiée'}</p>
                <div class="devoir-actions">
                    <button class="complete-btn">${devoir.completed ? 'Annuler' : 'Terminer'}</button>
                    <button class="edit-btn">Modifier</button>
                    <button class="delete-btn">Supprimer</button>
                </div>
            `;

            devoirList.appendChild(devoirItem);
        });
    }

    // Ajouter un devoir
    devoirForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = devoirTitleInput.value.trim();
        const description = devoirDescriptionInput.value.trim();
        const dueDate = devoirDueDateInput.value;

        if (title) {
            const newDevoir = {
                id: Date.now().toString(),
                title,
                description,
                dueDate,
                completed: false
            };
            devoirs.push(newDevoir);
            saveDevoirs();
            devoirTitleInput.value = '';
            devoirDescriptionInput.value = '';
            devoirDueDateInput.value = '';
            renderDevoirs();
        }
    });

    // Gérer les actions (terminer, modifier, supprimer)
    devoirList.addEventListener('click', (e) => {
        const target = e.target;
        const devoirItem = target.closest('.devoir-item');
        if (!devoirItem) return;

        const devoirId = devoirItem.dataset.id;
        const devoirIndex = devoirs.findIndex(d => d.id === devoirId);

        if (target.classList.contains('complete-btn')) {
            devoirs[devoirIndex].completed = !devoirs[devoirIndex].completed;
            saveDevoirs();
            renderDevoirs();
        } else if (target.classList.contains('delete-btn')) {
            devoirs.splice(devoirIndex, 1);
            saveDevoirs();
            renderDevoirs();
        } else if (target.classList.contains('edit-btn')) {
            // Implémenter la logique de modification (par exemple, ouvrir un modal ou remplir le formulaire)
            const devoirToEdit = devoirs[devoirIndex];
            devoirTitleInput.value = devoirToEdit.title;
            devoirDescriptionInput.value = devoirToEdit.description;
            devoirDueDateInput.value = devoirToEdit.dueDate;

            // Supprimer l'ancien devoir après l'édition
            devoirs.splice(devoirIndex, 1);
            saveDevoirs();
            renderDevoirs();
        }
    });

    // Charger les devoirs au démarrage
    loadDevoirs();
});
