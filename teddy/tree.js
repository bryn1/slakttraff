/* Släktträff 2026 — tree rendering. Builds the generation rows from API
   persons and applies the RSVP colour states to each spot. */
'use strict';

const GENERATION_LABELS = {
    1: 'Generation 1 - De Äldsta',
    2: 'Generation 2 - Barnen',
    3: 'Generation 3 - Barnbarnen',
    4: 'Generation 4 - Barnbarnsbarn',
    5: 'Generation 5 - Barnbarnsbarnsbarn',
};

function personCard(person) {
    const card = document.createElement('div');
    card.className = 'person-card' + (person.generation === 1 ? ' generation-1' : '');
    card.dataset.personId = person.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', person.name + ', ' + person.role);

    const name = document.createElement('div');
    name.className = 'person-name';
    name.textContent = person.name;
    const role = document.createElement('div');
    role.className = 'person-role';
    role.textContent = person.relation || person.role;

    card.appendChild(name);
    card.appendChild(role);
    return card;
}

function groupFor(person, byParent, groupClass, headerClass, childrenClass) {
    const parentId = person.parents && person.parents.length ? person.parents[0] : null;
    if (parentId === null) {
        return null;
    }
    let group = byParent.get(parentId);
    if (!group) {
        group = document.createElement('div');
        group.className = groupClass;
        const header = document.createElement('div');
        header.className = headerClass;
        group.appendChild(header);
        const children = document.createElement('div');
        children.className = childrenClass;
        group.appendChild(children);
        group._header = header;
        group._children = children;
        byParent.set(parentId, group);
    }
    return group;
}

function renderGeneration(persons, generation) {
    const row = document.createElement('div');
    row.className = 'generation-row';

    const label = document.createElement('div');
    label.className = 'generation-label';
    label.textContent = GENERATION_LABELS[generation] + ' (' + persons.length + ')';
    row.appendChild(label);

    const people = document.createElement('div');
    people.className = 'generation-people';
    const byParent = new Map();
    const loose = [];

    persons.forEach(person => {
        if (generation === 1) {
            people.appendChild(personCard(person));
            return;
        }
        const group = groupFor(person, byParent, 'family-group', 'family-group-header', 'family-group-children');
        if (group) {
            group._children.appendChild(personCard(person));
        } else {
            loose.push(person);
        }
    });

    // Parent headers: "Namn → N barn"
    byParent.forEach((group, parentId) => {
        const parent = window.__personsById[parentId];
        group._header.textContent = (parent ? parent.name : 'Okänd') + ' → ' +
            group._children.children.length + ' barn';
        people.appendChild(group);
    });
    loose.forEach(person => people.appendChild(personCard(person)));

    row.appendChild(people);
    return row;
}

function renderTree(persons) {
    const container = document.getElementById('family-tree');
    container.innerHTML = '';
    const generations = [...new Set(persons.map(p => p.generation))].sort((a, b) => a - b);

    generations.forEach((generation, index) => {
        if (index > 0) {
            const connector = document.createElement('div');
            connector.className = 'generation-connector';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'connector-svg');
            svg.setAttribute('viewBox', '0 0 1400 60');
            svg.setAttribute('preserveAspectRatio', 'none');
            connector.appendChild(svg);
            container.appendChild(connector);
        }
        const row = renderGeneration(
            persons.filter(p => p.generation === generation), generation);
        container.appendChild(row);
    });

    // Connector lines (tree-lines.js) after layout settles for this frame.
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
