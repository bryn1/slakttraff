/* Släktträff 2026 — tree rendering: generation bands (founders on top), invisible
   sibling groups under the parent, clean name cards (name, "f. ÅÅÅÅ" when the
   person has a birth year, Swedish relation line) and the per-card RSVP state.
   Presentation lives in tree.css; connector geometry in tree-lines.js. */
'use strict';

const GENERATION_LABELS = {
    1: 'Generation 1 - De Äldsta',
    2: 'Generation 2 - Barnen',
    3: 'Generation 3 - Barnbarnen',
    4: 'Generation 4 - Barnbarnsbarn',
    5: 'Generation 5 - Barnbarnsbarnsbarn',
};

/* Appended to the card's aria-label so screen readers state the RSVP answer */
const RSVP_ARIA_SUFFIXES = {
    accepted: ' — har svarat: kommer',
    declined: ' — har svarat: kommer inte',
};

function personCard(person) {
    const card = document.createElement('div');
    card.className = 'person-card gen-' + person.generation;
    card.dataset.personId = person.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.dataset.ariaBase = person.name + ', ' + person.role;
    card.setAttribute('aria-label', card.dataset.ariaBase);

    const name = document.createElement('div');
    name.className = 'person-name';
    name.textContent = person.name;
    card.appendChild(name);

    if (person.birth_year) {
        const birth = document.createElement('div');
        birth.className = 'person-birth';
        birth.textContent = 'f. ' + person.birth_year;
        card.appendChild(birth);
    }

    const relation = document.createElement('div');
    relation.className = 'person-relation';
    relation.textContent = person.relation || person.role;
    card.appendChild(relation);
    return card;
}

/* One band per generation: label + cards. Children of the same parent share an
   invisible .sibling-group box (tight gap) so siblings sit together under the
   parent; the connector lines carry the parent→child reading. */
function renderGeneration(persons, generation) {
    const row = document.createElement('div');
    row.className = 'generation-row gen-' + generation;

    const label = document.createElement('div');
    label.className = 'generation-label';
    label.textContent = GENERATION_LABELS[generation] + ' (' + persons.length + ')';
    row.appendChild(label);

    const people = document.createElement('div');
    people.className = 'generation-people';

    const byParent = new Map();
    const loose = [];

    persons.forEach(person => {
        const parentId = person.parents && person.parents.length ? person.parents[0] : null;
        if (parentId === null || generation === 1) {
            loose.push(person);
            return;
        }
        let group = byParent.get(parentId);
        if (!group) {
            group = document.createElement('div');
            group.className = 'sibling-group';
            byParent.set(parentId, group);
            people.appendChild(group);
        }
        group.appendChild(personCard(person));
    });

    loose.forEach(person => people.appendChild(personCard(person)));

    row.appendChild(people);
    return row;
}

/* Generation 1 (the founders) renders first: founders on top, generations 2-5
   as bands below. Connector lines are drawn once after layout settles. */
function renderTree(persons) {
    const container = document.getElementById('family-tree');
    container.innerHTML = '';
    const generations = [...new Set(persons.map(p => p.generation))].sort((a, b) => a - b);

    generations.forEach(generation => {
        container.appendChild(renderGeneration(
            persons.filter(p => p.generation === generation), generation));
    });

    if (typeof drawTreeLines === 'function') {
        requestAnimationFrame(drawTreeLines);
    }
}

function applyRsvpColour(personId, status) {
    const card = document.querySelector('.person-card[data-person-id="' + personId + '"]');
    if (!card) {
        return;
    }
    card.classList.remove('rsvp-accepted', 'rsvp-declined');
    if (status === 'accepted') {
        card.classList.add('rsvp-accepted');
    } else if (status === 'declined') {
        card.classList.add('rsvp-declined');
    }
    card.setAttribute('aria-label',
        card.dataset.ariaBase + (RSVP_ARIA_SUFFIXES[status] || ''));
}

function applyAllRsvpColours(persons) {
    persons.forEach(p => applyRsvpColour(p.id, p.rsvp_status));
}

function updateTreeStats(persons) {
    const total = persons.length;
    const accepted = persons.filter(p => p.rsvp_status === 'accepted').length;
    const declined = persons.filter(p => p.rsvp_status === 'declined').length;
    document.getElementById('tree-stats-total').innerHTML =
        '<strong>Totalt:</strong> ' + total + ' personer i ' +
        new Set(persons.map(p => p.generation)).size + ' generationer';
    document.getElementById('tree-stats-rsvp').textContent =
        accepted + ' kommer · ' + declined + ' hoppat av · ' +
        (total - accepted - declined) + ' ej svarat';
}
