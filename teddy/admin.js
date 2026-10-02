/* Admin page logic: password gate, change log + svarslista views, 30s refresh.
   Read-only page. Token lives in sessionStorage only; the password never does. */
"use strict";

const TOKEN_KEY = "slakttraff_admin_token";
const REFRESH_MS = 30000;
const STATUS_SV = { accepted: "kommer", declined: "hoppat av", pending: "ej svarat" };

const $ = (id) => document.getElementById(id);
const token = () => sessionStorage.getItem(TOKEN_KEY) || "";

/* Build an element safely: all API data goes through textContent (no innerHTML). */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function parseIso(iso) {
    // SQLite stores naive UTC; treat an ISO string without offset/zone as UTC.
    const withZone = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z";
    return new Date(withZone);
}

function fmtTime(iso) {
    if (!iso) return "—";
    const d = parseIso(iso);
    return isNaN(d) ? iso : d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

async function apiFetch(path) {
    const res = await fetch(path, { headers: { Authorization: "Bearer " + token() } });
    if (res.status === 401) { logout(); throw new Error("401 — sessionen löpte ut, logga in igen"); }
    if (!res.ok) {
        let detail = "";
        try { detail = (await res.json()).detail || ""; } catch (e) { /* non-JSON body */ }
        throw new Error(res.status + " " + res.statusText + (detail ? " — " + detail : ""));
    }
    return res.json();
}

/* ---------- gate ---------- */

function showGate() {
    $("password-screen").hidden = false;
    $("admin-content").hidden = true;
}

function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    showGate();
}

async function onLogin(ev) {
    ev.preventDefault();
    const errEl = $("password-error");
    errEl.textContent = "";
    try {
        const res = await fetch("api/admin/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: $("password-input").value }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            errEl.textContent = res.status === 429
                ? "För många försök — vänta en minut." : (body.detail || "Fel lösenord");
            return;
        }
        const { token: fresh } = await res.json();
        sessionStorage.setItem(TOKEN_KEY, fresh);
        $("password-input").value = "";
        enterApp();
    } catch (e) {
        errEl.textContent = "Kunde inte nå servern.";
    }
}

function enterApp() {
    showGate();
    $("password-screen").hidden = true;
    $("admin-content").hidden = false;
    loadAll();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadAll, REFRESH_MS);
}

/* ---------- data load ---------- */

let refreshTimer = null;

async function loadAll() {
    try {
        const [persons, replies, log] = await Promise.all([
            apiFetch("api/persons/?limit=500"),
            apiFetch("api/rsvp-replies/?limit=500"),
            apiFetch("api/admin/change-log?limit=500"),
        ]);
        $("api-error").hidden = true;
        renderCounts(persons);
        renderLog(log);
        renderReplies(persons, replies);
        $("log-loading").hidden = true;
        $("replies-loading").hidden = true;
        $("refresh-status").textContent =
            "Uppdaterad " + new Date().toLocaleTimeString("sv-SE");
    } catch (e) {
        const errEl = $("api-error");
        errEl.textContent = "Kunde inte hämta data: " + e.message;
        errEl.hidden = false;
        $("log-loading").hidden = true;
        $("replies-loading").hidden = true;
    }
}

/* ---------- rendering ---------- */

function renderCounts(persons) {
    const n = (s) => persons.filter((p) => p.rsvp_status === s).length;
    $("admin-counts").textContent =
        n("accepted") + " kommer · " + n("declined") + " hoppat av · " +
        n("pending") + " ej svarat";
}

function statusWord(word) {
    // Subtle colour hint on the status word only; word itself is plain text.
    const cls = word === "kommer" ? "chip chip-green"
        : word === "hoppat av" ? "chip chip-red" : "chip";
    return el("span", cls, word);
}

function eventCell(row) {
    const td = el("td");
    if (row.action === "contact") {
        td.append(el("span", null, "kontakt uppdaterad ("))
        td.append(statusWord(STATUS_SV[row.new_status] || row.new_status));
        td.append(el("span", null, ")"));
        return td;
    }
    const oldWord = STATUS_SV[row.old_status] || row.old_status || "?";
    td.append(statusWord(oldWord));
    td.append(el("span", "chip-arrow", " → "));
    td.append(statusWord(STATUS_SV[row.new_status] || row.new_status));
    return td;
}

function renderLog(log) {
    const body = $("log-body");
    body.replaceChildren();
    $("log-empty").hidden = log.length > 0;
    for (const row of log) {   // newest-first exactly as the API ordered it
        const tr = document.createElement("tr");
        tr.append(el("td", "admin-time", fmtTime(row.created_at)));
        tr.append(el("td", null, row.person_name));
        tr.append(eventCell(row));
        const contact = [row.email, row.phone].filter(Boolean).join(" · ");
        tr.append(el("td", null, contact || "—"));
        tr.append(el("td", null, row.notes || "—"));
        body.append(tr);
    }
}

function renderReplies(persons, replies) {
    const byPerson = new Map(replies.map((r) => [r.person_id, r]));
    const body = $("replies-body");
    body.replaceChildren();
    for (const p of persons) {
        const reply = byPerson.get(p.id);
        const tr = document.createElement("tr");
        tr.append(el("td", null, p.name));
        tr.append(el("td", null, "Gen " + p.generation));
        const tdStatus = el("td");
        tdStatus.append(statusWord(STATUS_SV[p.rsvp_status] || p.rsvp_status));
        tr.append(tdStatus);
        tr.append(el("td", null, (reply && reply.email) || "—"));
        tr.append(el("td", null, (reply && reply.phone) || "—"));
        tr.append(el("td", null, (reply && reply.notes) || "—"));
        body.append(tr);
    }
}

/* ---------- tabs ---------- */

function selectTab(which) {
    const logActive = which === "log";
    $("tab-log").setAttribute("aria-selected", String(logActive));
    $("tab-replies").setAttribute("aria-selected", String(!logActive));
    $("view-log").hidden = !logActive;
    $("view-replies").hidden = logActive;
}

/* ---------- wiring ---------- */

document.addEventListener("DOMContentLoaded", () => {
    $("password-form").addEventListener("submit", onLogin);
    $("refresh-btn").addEventListener("click", loadAll);
    $("logout-btn").addEventListener("click", logout);
    $("tab-log").addEventListener("click", () => selectTab("log"));
    $("tab-replies").addEventListener("click", () => selectTab("replies"));
    if (token()) enterApp(); else showGate();
});
