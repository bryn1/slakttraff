# BUILD — slakttraff hosting + password gate (2026-09-26)

Author: bryn1 (slakttraff build) <bryn1@users.noreply.github.com>
Card: slakttraff public hosting + shared site password (owner decisions 2026-09-26)

## What changed

- **A. Password gate**: `app/auth.py` (SITE_PASSWORD env, default `sibbamala`;
  `hmac.compare_digest`; in-memory opaque tokens via `secrets.token_hex`, 12 h TTL;
  0.5 s per-IP delay on wrong passwords; `require_token` FastAPI dependency) +
  `app/routers/auth.py` (`POST /api/auth` → `{"token"}`, 403 on wrong password).
  All persons/registrations/rsvp-replies endpoints now require
  `Authorization: Bearer <token>` (401 without).
- **B. Contact info with the reply**: new `RsvpReply` model (`app/models/rsvp_reply.py`,
  person_id FK, status, email, phone, notes). `RsvpSubmit` schema now requires `email`,
  optional `phone`/`notes`. RSVP endpoint stores a reply row. Contact info is exposed
  ONLY via the token-protected `GET /api/rsvp-replies` (admin view) — never in the
  public persons list.
- **C. Frontpage**: header is now "Släktträff i Sibbamåla hembygdsförening, datum
  annonseras snart"; rest of the design unchanged.
- **Frontend auth flow**: password screen first (`teddy/index.html` `#password-screen`,
  styled in `style.css`), token in `sessionStorage`, Bearer header on every API call
  (`teddy/api.js`), inline error on wrong password, any 401 clears the token and
  returns to the password screen. RSVP modal gained email/phone/notes fields.
- **D. PII out of the repo**: `app/seed.py` now loads `data/family.json` (62 real
  entries preserved on disk, gitignored); missing file → empty tree + clear log
  warning. `data/family.json.example` committed with "Person 1..." placeholders.
- **E. Hosting**: `server.py` at repo root (PORT env, uvicorn 0.0.0.0:$PORT, no
  reload) + `hosting.yaml` (strict JSON, port 8119).
- **F. Tests**: `tests/test_api.py` rewritten for the gate — 32 tests, all passing.

## How the password flow works

1. `GET /` serves the password screen (tree page hidden via `hidden` attribute).
2. `POST /api/auth {"password": "..."}` → 200 `{"token": "<64 hex>"}` or 403
   `{"detail": "Fel lösenord"}` (after a 0.5 s throttle).
3. Frontend stores the token in sessionStorage and sends `Authorization: Bearer <token>`
   on every API call; on 401 it clears the token and shows the password screen again.

## How to run

```
cd /srv/workspace/slakttraff
SLAKTTRAFF_DATABASE_URL="sqlite:////srv/workspace/slakttraff/data/slakttraff.db" \
  PORT=8119 .venv/bin/python server.py
```

## Verification evidence

pytest (VERIFIED, this session):

```
$ .venv/bin/python -m pytest tests/ -q
32 passed, 4 warnings in 2.11s
```

Live journey (VERIFIED, server booted via `server.py` on port 8124, curl):

```
GET /                        → 200, contains "password-screen" and the new heading
GET /api/persons/ (no token) → 401
POST /api/auth wrong pw      → 403 {"detail":"Fel lösenord"}
POST /api/auth correct pw    → 200, token length 64
POST /api/persons/1/rsvp {"status":"accepted","email":"test@example.se",
     "phone":"07011122","notes":"hej"} → 200, rsvp_status accepted
GET /api/rsvp-replies/ (with token) → [{"id":1,"person_id":1,"status":"accepted",
     "email":"test@example.se","phone":"07011122","notes":"hej",...}]
```

Hosting validation: `validate-hosting.py` was NOT found under
`/srv/workspace/agent-town/` (searched with find, zero hits) — noted per task
instructions. Manual validation instead: `hosting.yaml` parses as strict JSON with
the exact required keys (`name=slakttraff, type=service, root=apps/slakttraff,
exec=server.py, port=8119`).

File hygiene: all new/changed source files ≤ 400 lines (largest: tests 319, allowed
600; teddy/app.js 215). Password string appears only as the documented default in
`app/auth.py`.

## Open items

- Session tokens are in-memory: server restart logs everyone out (documented in
  docs/ARCHITECTURE.md).
- validate-hosting.py absent — run the real validator when it is available.

## Fix round 1 (DA verdict)

Fixes applied for the adversarial review at
`.audits/202609261055-00c5110e/DA-verdict.md` (commits c254164 + 219b12e):

- **P1-1** — sleep-based throttle replaced with a per-IP sliding-window failure
  counter (max 5 failures / 60 s, advanced atomically under a lock); tripped
  limit answers 429, correct passwords are never throttled.
- **P1-2** — both sides of the `hmac.compare_digest` comparison are UTF-8
  encoded; any input now yields 403, never 500.
- **P1-3 (owner decision)** — default password "sibbamala" kept as accepted;
  `SITE_PASSWORD` env override works and is documented in docs/ARCHITECTURE.md.
- **P1-4** — new `ADMIN_PASSWORD` env (no default). When unset, admin endpoints
  return 404. `GET /api/rsvp-replies` and registration GET/PUT/DELETE now need
  an admin token (separate store, `POST /api/admin/auth`).
- **P1-5** — person POST/PUT/DELETE gated behind the admin token; site password
  remains enough for GET tree data and the RSVP endpoint.
- **P2 duplicate replies** — RSVP is an upsert: one RsvpReply row per person,
  repeat submits update the existing row.
- **P2 session restart** — frontend already returns to the password screen on
  401 (teddy/api.js `_request` clears the token); documented in
  docs/ARCHITECTURE.md.
- **P3** — `/docs`, `/redoc`, `/openapi.json` disabled unless `SLAKTTRAFF_DEBUG=1`.

Verification (executed this session):

```
$ .venv/bin/python -m pytest tests/ -q
38 passed, 4 warnings in 1.80s

$ # 20 parallel wrong-password POSTs (xargs -P 20):
      5 403
     15 429
wall: .113s
$ # correct password after the failures:
200

Live journey (fresh DB, server.py on port 8179, curl):
GET /health                          → {"status":"ok","app":"Släktträff 2026"}
GET /docs, /openapi.json             → 404 404 (debug off)
POST /api/auth wrong pw              → 403
POST /api/auth "lösenåä"             → 403 (was 500)
POST /api/auth correct pw            → 200, token len 64
GET  /api/persons/ (site token)      → 200, tree JSON
GET  /api/rsvp-replies (site token)  → 404 (ADMIN_PASSWORD unset) / 401 (set)
DELETE /api/persons/1 (site token)   → 404/401 (admin-only now)
POST /api/persons/1/rsvp ×2          → 200; DB has ONE rsvp_replies row for
                                       person 1: (1,1,'declined','gast2@example.se')
POST /api/admin/auth (unset)         → 404
POST /api/admin/auth (set)           → 200, admin token reads rsvp-replies,
                                       admin DELETE person → 200
```
