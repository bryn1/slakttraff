/* Släktträff 2026 — family-tree connector lines (MC 3929). Draws thin neutral
   orthogonal elbows from each parent card to its children as ONE overlay SVG
   inside #family-tree, with a small dot at every junction; at <=640px the
   elbows simplify to a vertical stem + dot above each child. Geometry only:
   no data fetching, no click handling. Redrawn by tree.js after each
   renderTree, on resize and when fonts settle.

   MC 10028.2 (occlusion fix): every segment is obstacle-checked against the
   rendered cards and generation chips, so a connector never crosses a card's
   text block. Wrapped bands route through the free horizontal bands between
   sub-rows (and side channels when a straight drop would hit a card). */
'use strict';

const TREE_LINE_RESIZE_DEBOUNCE_MS = 150;
/* Keep every connector stroke this far clear of any card/chip border. */
const LINE_OBSTACLE_PAD = 2;
/* Mobile stem bounds: 16px concept length, clamped to the free space above. */
const LINE_MAX_STEM = 16;
const LINE_MIN_STEM = 6;

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

/* ---- Occlusion-safe orthogonal routing (MC 10028.2) ----------------------
   Obstacles are the rendered card boxes and generation chips, each inflated
   by LINE_OBSTACLE_PAD. A connector is a chain of axis-parallel segments;
   every segment is checked (or built inside a proven-free band) so no segment
   ever runs over another card's area — and therefore never over its text. */

function segmentHitsRectsX(rects, x, y1, y2) {
    /* Vertical segment at x: hits a box when x is inside it and the y spans
       overlap (strict — a segment ending exactly on a box edge is a touch). */
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    return rects.some(r => x > r.x1 && x < r.x2 && hi > r.y1 && lo < r.y2);
}

function complementBands(intervals, from, to) {
    /* Maximal free stretches of [from,to] not covered by any interval. */
    const clipped = intervals
        .map(iv => [Math.max(iv[0], from), Math.min(iv[1], to)])
        .filter(iv => iv[1] > iv[0])
        .sort((a, b) => a[0] - b[0]);
    const bands = [];
    let y = from;
    clipped.forEach(iv => {
        if (iv[0] > y) {
            bands.push({ a: y, b: iv[0] });
        }
        y = Math.max(y, iv[1]);
    });
    if (y < to) {
        bands.push({ a: y, b: to });
    }
    return bands;
}

/* Horizontal corridors (y values) across the full width that no obstacle
   occupies between yFrom and yTo: safe levels for bus segments. */
function freeYSlices(obstacles, yFrom, yTo) {
    return complementBands(
        obstacles.map(r => [r.y1, r.y2]).filter(iv => iv[1] > yFrom && iv[0] < yTo),
        yFrom, yTo);
}

/* Vertical corridors (x values) across the full height that no obstacle
   touching the window [yFrom,yTo] occupies: safe columns for trunk runs. */
function freeXSlices(obstacles, yFrom, yTo, xFrom, xTo) {
    return complementBands(
        obstacles
            .filter(r => r.y2 > yFrom && r.y1 < yTo)
            .map(r => [r.x1, r.x2]),
        xFrom, xTo);
}

/* Route one parent→child connector. Returns {pts: [[x,y],…]} from the
   parent's bottom-centre to the child's top-centre. Preference order:
   (1) the classic elbow at the gap mid-level, (2) the same elbow with the
   bus lifted/dropped into a free horizontal band, (3) a jog through a free
   side channel. Only falls back to the classic elbow if nothing is clean —
   the connector is never dropped. parent/child own boxes never count as
   obstacles (the route touches their edges on purpose). */
function routeConnector(parent, child, obstacles, width) {
    const own = obstacles.filter(r => r.el !== parent.el && r.el !== child.el);
    const ideal = (parent.bottom + child.top) / 2;
    const bands = freeYSlices(obstacles, parent.bottom, child.top);
    const elbowDots = busY => ({
        pts: [[parent.cx, parent.bottom], [parent.cx, busY],
              [child.cx, busY], [child.cx, child.top]],
    });

    const wide = bands.filter(b => b.b - b.a > 3)
        .sort((a, b) => Math.abs((a.a + a.b) / 2 - ideal) - Math.abs((b.a + b.b) / 2 - ideal));
    for (const band of wide) {
        const busY = (band.a + band.b) / 2;
        if (!segmentHitsRectsX(own, parent.cx, parent.bottom, busY) &&
            !segmentHitsRectsX(own, child.cx, busY, child.top)) {
            return elbowDots(busY);
        }
    }

    /* Jog: stub down to a free level, run across to a free column, drop to a
       free level just above the child, then across and in. */
    for (const topBand of bands) {
        const y1 = (topBand.a + topBand.b) / 2;
        if (segmentHitsRectsX(own, parent.cx, parent.bottom, y1)) {
            continue;
        }
        const below = bands.filter(b => b.a > y1 + 2);
        for (const botBand of below.slice().sort((a, b) => b.a - a.a)) {
            const y2 = (botBand.a + botBand.b) / 2;
            if (segmentHitsRectsX(own, child.cx, y2, child.top)) {
                continue;
            }
            const channels = freeXSlices(obstacles, y1 + 1, y2 - 1, 2, width - 2)
                .filter(ch => ch.b - ch.a > 1)
                .sort((a, b) => Math.abs((a.a + a.b) / 2 - (parent.cx + child.cx) / 2) -
                                Math.abs((b.a + b.b) / 2 - (parent.cx + child.cx) / 2));
            if (channels.length) {
                const gx = (channels[0].a + channels[0].b) / 2;
                return {
                    pts: [[parent.cx, parent.bottom], [parent.cx, y1],
                          [gx, y1], [gx, y2],
                          [child.cx, y2], [child.cx, child.top]],
                };
            }
        }
    }

    return elbowDots(ideal);
}

function treePathD(pts) {
    let d = 'M ' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (let i = 1; i < pts.length; i++) {
        d += pts[i][0] === pts[i - 1][0]
            ? ' V ' + pts[i][1].toFixed(1)
            : ' H ' + pts[i][0].toFixed(1);
    }
    return d;
}

function makeTreeDot(svg, x, y) {
    /* Small dot at a junction, per the concept design */
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'tree-dot');
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('r', '2.5');
    svg.appendChild(dot);
}

/* Mobile (<=640px): elbows become a short vertical stem with a dot above each
   child card — wrapped bands make full elbows spaghetti, and the card's own
   relation line ("Barn till …") still names the parent. The stem is clamped
   to the free space above the card so it never pierces the sub-row above
   (MC 10028.2). */
function drawMobileStems(svg, groups, rectOf, obstacles) {
    groups.forEach(group => {
        group.children.forEach(childCard => {
            const child = rectOf(childCard);
            let stem = LINE_MAX_STEM;
            obstacles.forEach(r => {
                if (r.el !== childCard && child.cx > r.x1 && child.cx < r.x2 &&
                    r.y2 <= child.top) {
                    stem = Math.min(stem, child.top - r.y2 - 2.5 - LINE_OBSTACLE_PAD);
                }
            });
            stem = Math.max(LINE_MIN_STEM, Math.min(LINE_MAX_STEM, stem));
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'tree-line');
            path.setAttribute('d', 'M ' + child.cx.toFixed(1) + ' ' +
                (child.top - stem).toFixed(1) + ' V ' + child.top.toFixed(1));
            svg.appendChild(path);
            makeTreeDot(svg, child.cx, child.top - stem);
        });
    });
}

/* One <path class="tree-line" d="... V .. H .. V .."> per parent→child link
   (stub, bus, drop) plus a dot at each junction: the parent stub meets the
   bus once per parent, every child's drop starts with its own dot. */
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
        const left = r.left - containerRect.left + container.scrollLeft;
        const top = r.top - containerRect.top + container.scrollTop;
        return {
            el: card,
            cx: left + r.width / 2,
            left: left,
            right: left + r.width,
            top: top,
            bottom: top + r.height,
        };
    };

    /* Obstacles for the router: every card box and every generation chip
       (chips are opaque too — a line behind one reads as severed). */
    const obstacles = [];
    container.querySelectorAll('.person-card, .generation-label').forEach(el => {
        const r = rectOf(el);
        obstacles.push({
            el: el,
            x1: r.left - LINE_OBSTACLE_PAD, y1: r.top - LINE_OBSTACLE_PAD,
            x2: r.right + LINE_OBSTACLE_PAD, y2: r.bottom + LINE_OBSTACLE_PAD,
        });
    });

    const groups = treeConnectorGroups(container);
    if (window.matchMedia('(max-width: 640px)').matches) {
        drawMobileStems(svg, groups, rectOf, obstacles);
        container.appendChild(svg);
        return;
    }

    const junctions = new Set();
    groups.forEach(group => {
        const parent = rectOf(group.parentCard);
        group.children.forEach(childCard => {
            const child = rectOf(childCard);
            if (child.top <= parent.bottom) {
                return; // non-downward geometry (overlap/edge case): skip, never draw up
            }
            const pts = routeConnector(parent, child, obstacles, width).pts;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'tree-line');
            path.setAttribute('d', treePathD(pts));
            svg.appendChild(path);
            /* Dots stay at the junctions: where the parent stub meets the bus
               (once per level) and where the child drop starts. */
            const parentJunction = pts[1][0].toFixed(1) + '@' + pts[1][1].toFixed(1);
            if (!junctions.has(parentJunction)) {
                junctions.add(parentJunction);
                makeTreeDot(svg, pts[1][0], pts[1][1]);
            }
            makeTreeDot(svg, pts[pts.length - 2][0], pts[pts.length - 2][1]);
        });
    });

    if (svg.childNodes.length > 0) {
        container.appendChild(svg);
    }
}

window.drawTreeLines = drawTreeLines;

let treeLineResizeTimer = null;
function scheduleTreeLineRedraw() {
    clearTimeout(treeLineResizeTimer);
    treeLineResizeTimer = setTimeout(drawTreeLines, TREE_LINE_RESIZE_DEBOUNCE_MS);
}
window.addEventListener('resize', scheduleTreeLineRedraw);

/* The tree re-wraps (rows grow/shrink) after RSVP marks, fonts or data land;
   a connector drawn against a transient layout lands on the wrong cards.
   Watching the container's own box catches every such reflow — the absolute
   overlay never changes it, so this cannot self-trigger. */
if (window.ResizeObserver) {
    const observed = document.getElementById('family-tree');
    if (observed) {
        new ResizeObserver(scheduleTreeLineRedraw).observe(observed);
    }
}

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
        if (window.__personsById) {
            drawTreeLines();
        }
    });
}
