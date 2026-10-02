/* Släktträff 2026 — family-tree connector lines (MC 3929). Draws classical
   orthogonal elbows from each parent card to its children as ONE overlay
   SVG inside #family-tree. Geometry only: no data fetching, no click
   handling. Redrawn by tree.js after each renderTree, on resize and when
   fonts settle. */
'use strict';

const TREE_LINE_RESIZE_DEBOUNCE_MS = 150;

/* Map parentId -> { parentCard, children: [card] } for every rendered child
   whose parents[0] also renders as a card. Missing/unrendered parents are
   skipped on purpose: no line is drawn to unknown relations. */
function treeConnectorGroups(container) {
    const cards = new Map();
    container.querySelectorAll('.person-card[data-person-id]').forEach(card => {
        cards.set(String(card.dataset.personId), card);
    });
    const groups = new Map();
    Object.values(window.__personsById || {}).forEach(person => {
        const parents = person.parents || [];
        if (!parents.length) {
            return;
        }
        const parentId = String(parents[0]);
        const parentCard = cards.get(parentId);
        const childCard = cards.get(String(person.id));
        if (!parentCard || !childCard) {
            return;
        }
        if (!groups.has(parentId)) {
            groups.set(parentId, { parentCard: parentCard, children: [] });
        }
        groups.get(parentId).children.push(childCard);
    });
    return groups;
}

function makeTreeLinePath(parent, child) {
    /* Classical elbow: stub down from the parent's bottom edge to the gap's
       mid-height (bus level), across to the child's top-centre, drop to the
       child's top edge. Siblings share busY, so their horizontal segments
       overlap and read as one shared bus. */
    const busY = parent.bottom + (child.top - parent.bottom) / 2;
    return 'M ' + parent.cx.toFixed(1) + ' ' + parent.bottom.toFixed(1) +
        ' V ' + busY.toFixed(1) +
        ' H ' + child.cx.toFixed(1) +
        ' V ' + child.top.toFixed(1);
}

/* One <path class="tree-line" d="... V .. H .. V .."> per parent→child link:
   three drawn segments (stub, bus, drop). */
function drawTreeLines() {
    const container = document.getElementById('family-tree');
    if (!container) {
        return;
    }
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) {
        return; // hidden (password screen) or mid-teardown: nothing to measure
    }
    const previous = container.querySelector('svg.tree-lines-overlay');
    if (previous) {
        previous.remove();
    }

    const width = Math.max(container.scrollWidth, Math.round(containerRect.width));
    const height = Math.max(container.scrollHeight, Math.round(containerRect.height));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tree-lines-overlay');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    /* getBoundingClientRect is viewport-relative, so page scroll cancels out
       in the card-vs-container differencing; the container's own scroll
       offsets are added so a scrolling wrapper stays correct. */
    const rectOf = card => {
        const r = card.getBoundingClientRect();
        const top = r.top - containerRect.top + container.scrollTop;
        return {
            cx: r.left - containerRect.left + container.scrollLeft + r.width / 2,
            top: top,
            bottom: top + r.height,
        };
    };

    treeConnectorGroups(container).forEach(group => {
        const parent = rectOf(group.parentCard);
        group.children.forEach(childCard => {
            const child = rectOf(childCard);
            if (child.top <= parent.bottom) {
                return; // non-downward geometry (overlap/edge case): skip, never draw up
            }
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'tree-line');
            path.setAttribute('d', makeTreeLinePath(parent, child));
            svg.appendChild(path);
        });
    });

    if (svg.childNodes.length > 0) {
        container.appendChild(svg);
    }
}

window.drawTreeLines = drawTreeLines;

let treeLineResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(treeLineResizeTimer);
    treeLineResizeTimer = setTimeout(drawTreeLines, TREE_LINE_RESIZE_DEBOUNCE_MS);
});

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
        if (window.__personsById) {
            drawTreeLines();
        }
    });
}
