# BUILD — Släktträff functional build (2026-09-25)

Commit: `35a47d1` on master in /srv/workspace/slakttraff (author "bryn1 (slakttraff build)").
Note on process: this run executed INLINE by the worker child — the harness capped subagent
spawning at maxDepth 1 (probe: "subagent depth 2 exceeds maxDepth 1"), so no sub-children
could be spawned. All phases (build, test, adversarial review, architecture check) were
performed and evidenced in this one session.

## What changed

1. **Open RSVP (owner decision "open click-and-answer")** — `app/routers/persons.py`:
   token check removed from POST /api/persons/{id}/rsvp; `app/schemas/person.py`:
   RsvpSubmit now carries `status` only. `rsvp_token` column kept, unused.
2. **Seed** — new `app/seed.py`: seeds the 62-person family tree (5 generations,
   parent/child links) once when the persons table is empty, called from `app/main.py`.
3. **One origin** — `app/main.py` mounts `teddy/` as StaticFiles(html=True) at "/",
   after the routers, so GET / serves the tree page and /api/*, /health keep precedence.
4. **Frontend wired to the API** — on load `api.js` fetches /api/persons/, `tree.js`
   renders the generation rows/family groups from API data (same visual design:
   original CSS classes preserved), spot colour reflects rsvp_status
   (green=accepted, red=declined, original=pending). Clicking a spot opens the modal
   with Accept/Decline buttons that POST to the RSVP endpoint and re-colour the spot
   immediately; stats line updates. Backend-down → visible red error banner
   (#api-error, role=alert). The registration form now POSTs to the real
   /api/registrations/ endpoint (was a setTimeout fake).
5. **File hygiene** — the 1420-line index.html split: markup only in index.html (140),
   style.css (332), tree.css (236), forms.css (130), api.js (36), tree.js (144),
   app.js (166). All source files ≤400 lines. Retired: localStorage name editing and
   the empty "click for name" slots (replaced by API-backed data).

## How to run

```
cd /srv/workspace/slakttraff
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000
# open http://127.0.0.1:8000/
```

## Verification (executed this session)

- `.venv/bin/python -m pytest tests/ -q` → **22 passed** (updated token-gate tests,
  new open-endpoint tests incl. invalid status → 422, static-serving tests).
- Live server probes (uvicorn on :8765, fresh DB):
  - `POST /api/persons/1/rsvp {"status":"accepted"}` (no token) → `Erik -> accepted`
  - `POST /api/persons/2/rsvp {"status":"declined"}` → `Gösta -> declined`
  - `POST ... {"status":"maybe"}` → HTTP 422
  - `GET /api/persons/` → counts: accepted 1 | declined 1 | total 62
  - `GET /` → 200 text/html containing rsvp-accept-btn; /style.css /tree.css
    /forms.css /api.js /tree.js /app.js all 200.
- `node --check` on all three JS files → OK.

## Open items

- Visual browser QA (screenshot/vision) not run — no browser tooling in this session;
  DOM/HTTP-level checks above are the evidence.
- Write/delete endpoints remain unauthenticated (pre-existing, owner decision pending).
