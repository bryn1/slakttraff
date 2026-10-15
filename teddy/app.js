/* Släktträff 2026 — page wiring: load, person modal + RSVP, registration form. */
'use strict';

let personsById = {};
let currentPersonId = null;
/* The card that opened the dialog; focus returns here on close (F2 a11y). */
let lastFocusedCard = null;

function showError(message) {
    const banner = document.getElementById('api-error');
    if (message) {
        banner.textContent = message;
        banner.classList.add('active');
    } else {
        banner.classList.remove('active');
    }
}

/* --- Person modal + RSVP --- */

const modal = document.getElementById('person-modal');

function rsvpStatusText(status) {
    if (status === 'accepted') {
        return 'Du har svarat: Kommer ✓';
    }
    if (status === 'declined') {
        return 'Du har svarat: Kommer inte ✗';
    }
    return 'Inget svar ännu — klicka på en knapp nedan.';
}

/* Accent bar on the popup mirrors the person's generation color (modal.css) */
function setModalAccent(generation) {
    const box = modal.querySelector('.modal-content');
    box.classList.remove('gen-1', 'gen-2', 'gen-3', 'gen-4', 'gen-5');
    box.classList.add('gen-' + generation);
}

function openPersonModal(person) {
    currentPersonId = person.id;
    lastFocusedCard = document.querySelector(
        '.person-card[data-person-id="' + person.id + '"]');
    setModalAccent(person.generation);
    document.getElementById('modal-name').textContent = person.name;
    document.getElementById('modal-generation').textContent = 'Generation ' + person.generation;
    document.getElementById('modal-role').textContent = person.role;
    document.getElementById('modal-relation').textContent = person.relation || person.role;
    document.getElementById('modal-description').textContent = person.description || '';
    document.getElementById('modal-rsvp-status').textContent = rsvpStatusText(person.rsvp_status);
    modal.classList.add('active');
    /* Real dialog semantics: the page behind is inert (no Tab, no clicks, out
       of the a11y tree), then initial focus lands on the close button. */
    document.getElementById('site-content').inert = true;
    setModalError('');
    document.getElementById('modal-close-btn').focus();
}

/* RSVP feedback must render INSIDE the dialog: #api-error sits in the inert
   background (behind the overlay, out of the a11y tree) while the dialog is
   open, so the banner stays reserved for non-dialog contexts (P1-2). */
function setModalError(message) {
    const node = document.getElementById('modal-error');
    node.textContent = message || '';
    node.hidden = !message;
}

function closeModal() {
    modal.classList.remove('active');
    document.getElementById('site-content').inert = false;
    if (lastFocusedCard && lastFocusedCard.isConnected) {
        lastFocusedCard.focus();
    }
    lastFocusedCard = null;
    currentPersonId = null;
}

async function answerRsvp(status) {
    if (currentPersonId === null) {
        return;
    }
    const personId = currentPersonId;
    const email = document.getElementById('rsvp-email').value.trim();
    if (!email) {
        setModalError('Fyll i din e-postadress så vi kan nå dig.');
        return;
    }
    const contact = {
        email: email,
        phone: document.getElementById('rsvp-phone').value.trim(),
        notes: document.getElementById('rsvp-notes').value.trim(),
    };
    const buttons = [document.getElementById('rsvp-accept-btn'), document.getElementById('rsvp-decline-btn')];
    /* Disabling the FOCUSED button drops focus to BODY — with the inert
       background that is a keyboard pocket outside the dialog: park focus on
       the close button during the POST and return it to the pressed button
       afterwards (unless the dialog closed on success). */
    const sourceBtn = buttons.includes(document.activeElement) ? document.activeElement : null;
    buttons.forEach(btn => { btn.disabled = true; });
    if (sourceBtn) {
        document.getElementById('modal-close-btn').focus();
    }
    try {
        const updated = await API.submitRsvp(personId, status, contact);
        personsById[personId] = updated;
        applyRsvpColour(personId, updated.rsvp_status);
        document.getElementById('modal-rsvp-status').textContent = rsvpStatusText(updated.rsvp_status);
        updateTreeStats(Object.values(personsById));
        setModalError('');
        showError(null);
        closeModal();
    } catch (err) {
        setModalError('Kunde inte spara ditt svar: ' + err.message);
    } finally {
        buttons.forEach(btn => { btn.disabled = false; });
        if (sourceBtn && sourceBtn.isConnected && modal.classList.contains('active')) {
            sourceBtn.focus();
        }
    }
}

function bindModal() {
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('rsvp-accept-btn').addEventListener('click', () => answerRsvp('accepted'));
    document.getElementById('rsvp-decline-btn').addEventListener('click', () => answerRsvp('declined'));
    modal.addEventListener('click', e => {
        if (e.target === modal) {
            closeModal();
        }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
    /* Tab wrap at the dialog bounds (belt for the inert background): keeps the
       cycle inside the popup on browsers without inert support. Bound to
       DOCUMENT while the dialog is open — keydown from BODY (e.g. after a
       disabled RSVP button dropped focus) never reaches a modal-bound
       handler, which is exactly the state the belt is needed in. Only ever
       preventDefaults at the dialog bounds. */
    document.addEventListener('keydown', e => {
        if (e.key !== 'Tab' || !modal.classList.contains('active')) {
            return;
        }
        const focusables = modal.querySelectorAll(
            'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) {
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
}

function bindSpotClicks() {
    document.getElementById('family-tree').addEventListener('click', e => {
        const card = e.target.closest('.person-card');
        if (card && personsById[card.dataset.personId]) {
            openPersonModal(personsById[card.dataset.personId]);
        }
    });
    document.getElementById('family-tree').addEventListener('keydown', e => {
        const card = e.target.closest('.person-card');
        if (card && (e.key === 'Enter' || e.key === ' ') && personsById[card.dataset.personId]) {
            e.preventDefault();
            openPersonModal(personsById[card.dataset.personId]);
        }
    });
}

/* --- Registration form (real API submit) --- */

function bindForm() {
    const form = document.getElementById('registration-form');
    const formContainer = document.getElementById('form-container');
    const successMessage = document.getElementById('success-message');
    const submitBtn = form.querySelector('.submit-btn');

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const formData = new FormData(form);
        const generations = formData.getAll('generations');
        if (generations.length === 0) {
            alert('Vänligen välj minst en generation du tillhör.');
            return;
        }
        submitBtn.textContent = 'Skickar...';
        submitBtn.disabled = true;
        try {
            await API.submitRegistration({
                name: formData.get('name'),
                email: formData.get('email'),
                generations: generations.map(g => parseInt(g, 10)),
                group_size: formData.get('group-size'),
                notes: formData.get('notes') || null,
            });
            formContainer.style.display = 'none';
            successMessage.classList.add('active');
            successMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Re-fetch and re-render the tree so the new registration shows
            // without a manual reload. init() shows its own error and leaves
            // the success message untouched if the re-fetch fails.
            await init();
        } catch (err) {
            showError('Kunde inte skicka anmälan: ' + err.message);
        } finally {
            submitBtn.textContent = 'Skicka Anmälan';
            submitBtn.disabled = false;
        }
    });

    document.getElementById('reset-form-btn').addEventListener('click', () => {
        form.reset();
        successMessage.classList.remove('active');
        formContainer.style.display = 'block';
    });
}

/* --- Password gate --- */

function showPasswordScreen() {
    document.getElementById('password-screen').style.display = 'flex';
    document.getElementById('site-content').hidden = true;
    document.getElementById('password-input').value = '';
    document.getElementById('password-error').textContent = '';
}

function showSiteContent() {
    document.getElementById('password-screen').style.display = 'none';
    document.getElementById('site-content').hidden = false;
}

function bindPasswordGate() {
    const form = document.getElementById('password-form');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const password = document.getElementById('password-input').value;
        const errorEl = document.getElementById('password-error');
        errorEl.textContent = '';
        let token = null;
        try {
            token = await API.login(password);
        } catch (err) {
            errorEl.textContent = err.message;
            return;
        }
        if (!token) {
            errorEl.textContent = 'Fel lösenord. Försök igen.';
            return;
        }
        showSiteContent();
        init();
    });
}

/* --- Init --- */

async function init() {
    try {
        const persons = await API.fetchPersons();
        personsById = {};
        persons.forEach(p => { personsById[p.id] = p; });
        window.__personsById = personsById;
        renderTree(persons);
        applyAllRsvpColours(persons);
        updateTreeStats(persons);
        bindSpotClicks();
        showError(null);
    } catch (err) {
        showError('Kunde inte ladda släktträdet: ' + err.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    API.onUnauthorized = showPasswordScreen;
    bindPasswordGate();
    bindModal();
    bindForm();
    if (API.token()) {
        showSiteContent();
        init();
    } else {
        showPasswordScreen();
    }
});
