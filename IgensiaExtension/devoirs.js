// « Mes devoirs » : vue du popup (#view-devoirs) + tuile de résumé sur l'accueil.
// Stockage : chrome.storage.local.devoirs = [{ id, title, subject, description, dueDate: 'YYYY-MM-DD', completed }]
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('devoir-form');
    const formTitle = document.getElementById('devoir-form-title');
    const titleInput = document.getElementById('devoir-title');
    const titleError = document.getElementById('devoir-title-error');
    const descriptionInput = document.getElementById('devoir-description');
    const dueDateInput = document.getElementById('devoir-due-date');
    const subjectSelect = document.getElementById('devoir-subject');
    const filterSelect = document.getElementById('devoir-filter-subject');
    const subjectsHint = document.getElementById('subjects-hint');
    const dueSuggestion = document.getElementById('due-suggestion');
    const submitBtn = document.getElementById('devoir-submit');
    const cancelEditBtn = document.getElementById('devoir-cancel-edit');
    const todoList = document.getElementById('devoir-list');
    const doneList = document.getElementById('devoir-done-list');
    const doneSection = document.getElementById('done-section');
    const todoCount = document.getElementById('devoirs-todo-count');
    const doneCount = document.getElementById('devoirs-done-count');
    const shortcutSummary = document.getElementById('devoirs-summary');
    const shortcutCount = document.getElementById('devoirs-count');

    let devoirs = [];
    let subjects = [];   // matières connues (relevé de notes + EDT)
    let edtEvents = [];  // pour suggérer l'échéance = prochain cours de la matière
    let editingId = null;

    // ---------- Dates ----------
    function todayStart() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function parseDueDate(value) {
        const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }

    function toDateInputValue(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function daysUntil(date) {
        return Math.round((date - todayStart()) / 86400000);
    }

    function formatShortDate(date) {
        return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    }

    // Libellé + style de la pastille d'échéance
    function dueInfo(devoir) {
        const date = parseDueDate(devoir.dueDate);
        if (!date) return null;
        const days = daysUntil(date);
        if (devoir.completed) return { text: formatShortDate(date), cls: '' };
        if (days < 0) return { text: days === -1 ? 'En retard · hier' : `En retard · ${-days} j`, cls: 'chip-late' };
        if (days === 0) return { text: "Aujourd'hui", cls: 'chip-late' };
        if (days === 1) return { text: 'Demain', cls: 'chip-soon' };
        if (days <= 6) return { text: `Dans ${days} j · ${formatShortDate(date)}`, cls: 'chip-soon' };
        return { text: formatShortDate(date), cls: '' };
    }

    function sortByDueDate(list) {
        // Sans date à la fin
        return list.slice().sort((a, b) => {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return a.dueDate.localeCompare(b.dueDate);
        });
    }

    // ---------- Matières ----------
    function fillSelect(select, names) {
        const current = select.value;
        while (select.options.length > 1) select.remove(1);
        names.forEach(name => select.add(new Option(name, name)));
        select.value = names.includes(current) ? current : '';
    }

    function refreshSubjectSelects() {
        // Inclure les matières des devoirs existants (matière disparue du relevé, ancienne saisie…)
        const all = [...subjects];
        const known = new Set(all.map(s => s.toLowerCase()));
        devoirs.forEach(d => {
            if (d.subject && !known.has(d.subject.toLowerCase())) {
                known.add(d.subject.toLowerCase());
                all.push(d.subject);
            }
        });
        all.sort((a, b) => a.localeCompare(b, 'fr'));
        fillSelect(subjectSelect, all);
        // Le filtre ne propose que les matières qui ont au moins un devoir
        fillSelect(filterSelect, all.filter(name => devoirs.some(d => d.subject === name)));
        filterSelect.hidden = filterSelect.options.length <= 1;
        subjectsHint.hidden = subjects.length > 0;
    }

    // Prochain cours de la matière choisie → proposer sa date comme échéance
    function normalize(text) {
        return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    }

    function nextCourseFor(subject) {
        const target = normalize(subject);
        if (!target) return null;
        const now = Date.now();
        return edtEvents
            .filter(ev => Date.parse(ev.start) > now)
            .filter(ev => [ev.matiere, ev.libelle, ev.title].some(name => {
                const n = normalize(name);
                return n && (n === target || n.includes(target) || target.includes(n));
            }))
            .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] || null;
    }

    function updateDueSuggestion() {
        const course = nextCourseFor(subjectSelect.value);
        if (!course) {
            dueSuggestion.hidden = true;
            return;
        }
        const date = new Date(course.start);
        const value = toDateInputValue(date);
        if (dueDateInput.value === value) {
            dueSuggestion.hidden = true;
            return;
        }
        dueSuggestion.textContent = `Prochain cours : ${formatShortDate(date)}. `;
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'hint-action';
        useBtn.textContent = 'Utiliser cette date';
        useBtn.addEventListener('click', () => {
            dueDateInput.value = value;
            dueSuggestion.hidden = true;
        });
        dueSuggestion.appendChild(useBtn);
        dueSuggestion.hidden = false;
    }

    // ---------- Rendu ----------
    // Texte d'une pastille dans un <span> : l'ellipse ne s'applique pas à un nœud texte nu en flex
    function chipText(text) {
        const span = document.createElement('span');
        span.className = 'chip-text';
        span.textContent = text;
        return span;
    }

    function createDevoirItem(devoir) {
        const li = document.createElement('li');
        li.className = 'devoir-item';
        li.classList.toggle('is-done', !!devoir.completed);
        li.classList.toggle('is-editing', devoir.id === editingId);
        li.dataset.id = devoir.id;

        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'check-btn';
        check.dataset.action = 'toggle';
        check.setAttribute('aria-label', devoir.completed ? `Marquer « ${devoir.title} » comme à faire` : `Marquer « ${devoir.title} » comme terminé`);
        check.innerHTML = iconSvg('check');

        const main = document.createElement('div');
        main.className = 'devoir-main';
        const title = document.createElement('p');
        title.className = 'devoir-title';
        title.textContent = devoir.title;
        main.appendChild(title);
        if (devoir.description) {
            const desc = document.createElement('p');
            desc.className = 'devoir-desc';
            desc.textContent = devoir.description;
            main.appendChild(desc);
        }

        const meta = document.createElement('div');
        meta.className = 'devoir-meta';
        const due = dueInfo(devoir);
        if (due) {
            const chip = document.createElement('span');
            chip.className = `chip ${due.cls}`;
            chip.innerHTML = iconSvg('calendar');
            chip.appendChild(chipText(due.text));
            meta.appendChild(chip);
        }
        if (devoir.subject) {
            const chip = document.createElement('span');
            chip.className = 'chip chip-subject';
            chip.title = devoir.subject;
            chip.innerHTML = iconSvg('book');
            chip.appendChild(chipText(devoir.subject));
            meta.appendChild(chip);
        }
        if (meta.children.length) main.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'devoir-actions';
        actions.innerHTML = `
            <button type="button" class="action-btn" data-action="edit" aria-label="Modifier">${iconSvg('pencil')}</button>
            <button type="button" class="action-btn is-danger" data-action="delete" aria-label="Supprimer">${iconSvg('trash')}</button>`;

        li.append(check, main, actions);
        return li;
    }

    function renderEmpty(list, text) {
        const li = document.createElement('li');
        li.className = 'empty-state';
        li.innerHTML = iconSvg('inbox');
        li.append(text);
        list.appendChild(li);
    }

    function renderDevoirs() {
        const filter = filterSelect.value;
        const visible = sortByDueDate(filter ? devoirs.filter(d => d.subject === filter) : devoirs);
        const todo = visible.filter(d => !d.completed);
        const done = visible.filter(d => d.completed);

        todoList.innerHTML = '';
        doneList.innerHTML = '';
        todo.forEach(d => todoList.appendChild(createDevoirItem(d)));
        done.forEach(d => doneList.appendChild(createDevoirItem(d)));
        if (!todo.length) renderEmpty(todoList, filter ? 'Rien à faire dans cette matière.' : 'Aucun devoir à faire. Profites-en !');

        todoCount.textContent = todo.length ? `(${todo.length})` : '';
        doneCount.textContent = `(${done.length})`;
        doneSection.hidden = done.length === 0;
    }

    // Tuile « Mes devoirs » de l'accueil
    function renderShortcut() {
        const todo = sortByDueDate(devoirs.filter(d => !d.completed));
        const late = todo.filter(d => {
            const date = parseDueDate(d.dueDate);
            return date && daysUntil(date) < 0;
        });
        shortcutCount.hidden = todo.length === 0;
        shortcutCount.textContent = String(todo.length);
        shortcutSummary.classList.toggle('is-late', late.length > 0);

        if (!todo.length) {
            shortcutSummary.textContent = 'Aucun devoir à rendre';
        } else if (late.length) {
            shortcutSummary.textContent = late.length === 1 ? `1 devoir en retard : ${late[0].title}` : `${late.length} devoirs en retard`;
        } else {
            const next = todo[0];
            const due = dueInfo(next);
            shortcutSummary.textContent = due ? `${next.title} · ${due.text}` : next.title;
        }
    }

    function renderAll() {
        refreshSubjectSelects();
        renderDevoirs();
        renderShortcut();
    }

    // ---------- Formulaire ----------
    function saveDevoirs() {
        chrome.storage.local.set({ devoirs });
    }

    function setFormTitle(icon, text) {
        formTitle.firstElementChild.innerHTML = iconSvg(icon);
        formTitle.lastChild.textContent = text;
    }

    function resetForm() {
        editingId = null;
        form.reset();
        form.classList.remove('is-editing');
        setFormTitle('plus', 'Nouveau devoir');
        submitBtn.textContent = 'Ajouter';
        cancelEditBtn.hidden = true;
        titleError.hidden = true;
        titleInput.removeAttribute('aria-invalid');
        dueSuggestion.hidden = true;
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = titleInput.value.trim();
        if (!title) {
            titleError.hidden = false;
            titleInput.setAttribute('aria-invalid', 'true');
            titleInput.focus();
            return;
        }
        const values = {
            title,
            subject: subjectSelect.value,
            description: descriptionInput.value.trim(),
            dueDate: dueDateInput.value
        };
        const existing = editingId && devoirs.find(d => d.id === editingId);
        if (existing) {
            Object.assign(existing, values);
        } else {
            devoirs.push({ id: Date.now().toString(), ...values, completed: false });
        }
        saveDevoirs();
        resetForm();
        renderAll();
    });

    titleInput.addEventListener('input', () => {
        if (titleInput.value.trim()) {
            titleError.hidden = true;
            titleInput.removeAttribute('aria-invalid');
        }
    });

    subjectSelect.addEventListener('change', updateDueSuggestion);
    dueDateInput.addEventListener('change', updateDueSuggestion);

    cancelEditBtn.addEventListener('click', () => {
        resetForm();
        renderDevoirs();
    });

    function startEdit(devoir) {
        editingId = devoir.id;
        titleInput.value = devoir.title;
        descriptionInput.value = devoir.description || '';
        dueDateInput.value = devoir.dueDate || '';
        subjectSelect.value = devoir.subject || '';
        form.classList.add('is-editing');
        setFormTitle('pencil', 'Modifier le devoir');
        submitBtn.textContent = 'Enregistrer';
        cancelEditBtn.hidden = false;
        updateDueSuggestion();
        renderDevoirs();
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        titleInput.focus({ preventScroll: true });
    }

    // ---------- Actions sur la liste ----------
    function onListClick(e) {
        const button = e.target.closest('button[data-action]');
        const item = e.target.closest('.devoir-item');
        if (!button || !item) return;
        const devoir = devoirs.find(d => d.id === item.dataset.id);
        if (!devoir) return;

        if (button.dataset.action === 'toggle') {
            devoir.completed = !devoir.completed;
            saveDevoirs();
            renderAll();
        } else if (button.dataset.action === 'edit') {
            startEdit(devoir);
        } else if (button.dataset.action === 'delete') {
            if (!confirm(`Supprimer « ${devoir.title} » ?`)) return;
            devoirs = devoirs.filter(d => d.id !== devoir.id);
            if (devoir.id === editingId) resetForm();
            saveDevoirs();
            renderAll();
        }
    }

    todoList.addEventListener('click', onListClick);
    doneList.addEventListener('click', onListClick);
    filterSelect.addEventListener('change', renderDevoirs);

    // ---------- Chargement ----------
    chrome.storage.local.get(['devoirs', 'igs_subjects', 'igs_edt_events'], (res) => {
        devoirs = res.devoirs || [];
        subjects = res.igs_subjects || [];
        edtEvents = res.igs_edt_events || [];
        renderAll();
    });

    // La synchro EDT/notes du popup peut ajouter des matières pendant qu'il est ouvert
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.igs_subjects) subjects = changes.igs_subjects.newValue || [];
        if (changes.igs_edt_events) edtEvents = changes.igs_edt_events.newValue || [];
        if (changes.igs_subjects || changes.igs_edt_events) {
            refreshSubjectSelects();
            updateDueSuggestion();
        }
    });
});
