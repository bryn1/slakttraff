# ARCHITECTURE — Släktträff (svarkor-slakttraff-anmalan)

Family-reunion signup backend + frontend, served as ONE origin. Status: functional —
site-password gated, RSVP with contact info, tree rendered from API data
(build 2026-09-26). Public at sibbamala.com/slakttraff (vm106 reconciler).

## Tree

```
server.py           Repo-root entrypoint for the host: reads PORT env, runs uvicorn
                    on 0.0.0.0:$PORT (no reload). Default port 8120 (8119 is the live portfolio app).
hosting.yaml        Hosting manifest for the vm106 reconciler (strict JSON).
requirements.txt    Runtime deps, exact pins (vm106 build gate requirement).
requirements-dev.txt  Test-only tools (pytest), not installed on the public host.
app/
  main.py            FastAPI app: CORS (env SLAKTTRAFF_CORS_ORIGINS), /health,
                     seeds family tree on fresh DB, mounts teddy/ as static files at "/"
  auth.py            Site-password gate: SITE_PASSWORD env (default "sibbamala"),
                     hmac.compare_digest check (UTF-8 encoded, any input -> 403 not 500),
                     in-memory opaque session tokens (12 h TTL), parallel-safe per-IP
                     failure counter (max 5/60 s → 429), require_token dep;
                     ADMIN_PASSWORD env (default "grisfest", owner-approved
                     2026-09-26) + admin token store +
                     require_admin_token dep (401 without admin token)
  database.py        SQLAlchemy engine; SQLite at data/slakttraff.db locally; $STATE_DIRECTORY/slakttraff.db on vm106 (set by server.py; env SLAKTTRAFF_DATABASE_URL wins)
  seed.py            Loads data/family.json + seed_persons_if_empty() (empty tree + log
                     warning when the file is missing)
  services/family_import.py  import_family(db, entries) -> count: inserts one Person per
                     family.json-style entry and wires parents/children (flush only —
                     the caller owns the transaction). Shared by seed.py and the admin
                     import endpoint.
  models/person.py        Person (name, birth_year, generation, role, relation, description,
                           parents/children/spouses JSON, rsvp_status, rsvp_token [legacy, unused])
  models/registration.py  Registration (name, email, generations, group_size, notes,
                           person_id — nullable FK to persons.id, the registration's
                           family-tree spot)
  models/rsvp_reply.py    RsvpReply (person_id FK, status, email, phone, notes) — contact
                           info submitted with an RSVP; admin-visible only
  models/change_log.py    ChangeLog (person_id FK, person_name snapshot, action
                          "status"|"contact", old/new_status, contact snapshot AFTER
                          the change, created_at) — audit trail of RSVP changes (MC 3928)
  schemas/enums.py        Generation, GroupSize, RsvpStatus
  schemas/person.py       PersonBase/Create/Update/Person/PersonResponse,
                          RsvpSubmit (status + email + phone? + notes?), RsvpReplyResponse, ChangeLogResponse
  schemas/registration.py RegistrationBase/Create/Update/Registration/RegistrationResponse
  routers/admin.py        POST /api/admin/import-family (admin token): replace-all import
                          of a family.json-style entry list — deletes existing persons
                          and their RsvpReply rows, inserts the posted list in one
                          transaction, returns {"imported": N}. Malformed entries
                          (missing key/name/generation, duplicate keys, unknown parent
                          refs, non-object items) -> 422; an empty list -> 400 (a
                          replace-all of nothing would wipe the tree). Existing
                          registrations.person_id links are nulled before the delete
                          so no orphaned FK values survive the replace-all.
  routers/auth.py         POST /api/auth {"password"} -> {"token"} (403 wrong password,
                          429 when the per-IP failure limit trips) and
                          POST /api/admin/auth -> admin token (403 on wrong password)
  routers/persons.py      GET persons + POST /api/persons/{id}/rsvp (site token);
                          POST/PUT/DELETE persons (admin token). RSVP is an UPSERT:
                          one RsvpReply row per person, repeat submits update it; a
                          real change (status or contact) adds ONE change_logs row
                          (an identical resubmit logs nothing)
  routers/registrations.py POST /api/registrations/ (site token, the public signup form);
                          each signup also creates a linked Person tree spot (role
                          "Anmäld", rsvp pending, lowest selected generation) in the
                          same transaction and stores its id in registrations.person_id.
                          GET/PUT/DELETE (admin token — registrations carry contact info)
  routers/rsvp_replies.py  GET /api/rsvp-replies (admin token only; the contact-info view)
  routers/change_log.py   GET /api/admin/change-log (admin token only): the RSVP
                          audit trail, newest first, skip/limit paging
teddy/
  index.html          markup (password screen, header, tree container, form, person modal
                      with contact fields)
  style.css           base layout, header, password screen, modal, responsive
  tree.css            family tree, person spots, RSVP colour states (green/red)
  forms.css           registration form + success message
  api.js              API client (login, fetchPersons, submitRsvp, submitRegistration);
                      sends Bearer token, on 401 clears token + returns to password screen
  tree.js             tree rendering from API data + RSVP colour application
                      + connector redraw hook (drawTreeLines)
  tree-lines.js       classical family-tree connector lines (MC 3929): one
                      overlay SVG in #family-tree, one elbow path (stub/bus/
                      drop) per rendered parent→child link (parents[0]),
                      coords relative to the tree container, redrawn on
                      render, resize (150 ms debounce) and fonts.ready;
                      pointer-events:none, aria-hidden, below the cards;
                      no data logic, no click handling
  app.js              page wiring: password gate, init/load, person modal + RSVP +
                      contact fields, form submit
  admin.html          admin page (MC 3930): admin password gate + two tabs —
                      "Ändringslogg" (RSVP change-log audit table, newest first,
                      humanised Swedish status words with green/red colour hint)
                      and "Svarslista" (all persons: name, generation, status
                      chip, e-post, telefon, allergier/kostpreferenser joined
                      from rsvp-replies by person_id, "—" when none); read-only;
                      counts row "X kommer · Y hoppat av · Z ej svarat";
                      honest empty/loading/error states
  admin.js            admin logic: POST api/admin/auth gate — admin token in
                      sessionStorage key slakttraff_admin_token ONLY (never the
                      password, never the URL); any 401 clears the token and
                      returns to the gate; change-log/persons/rsvp-replies
                      fetched relative (mount-prefix safe), rendered via
                      textContent only (no innerHTML: free-text names and notes
                      cannot inject markup); 30 s auto-refresh + Uppdatera;
                      naive-UTC created_at treated as UTC before sv-SE display
  admin.css           admin-only styling: tabs, table, chips, sr-only; forces
                      [hidden] over style.css's .password-screen display:flex
                      (that rule beats the UA [hidden] and would leave the gate
                      painted over the content after login); colour tokens are
                      style.css's, nothing invented
tests/test_api.py    pytest contract tests (TestClient, isolated temp DB)
tests/test_admin_import.py  admin family-import + startup-migration contract tests
tests/test_change_log.py  RSVP change-log contract tests (audit rows, auth, ordering)
                     (split from test_api.py for file hygiene; same pattern)
data/
  family.json           real family data (GITIGNORED — personal data, never commit)
  family.json.example   placeholder shape ("Person 1"...) committed for fresh clones
```

## Entrypoint

`PORT=8120 python3 server.py` (or `.venv/bin/uvicorn app.main:app --port 8120`) —
GET / serves the password screen, `/api/*` the JSON API, `/health` the health check.
All one origin.

## Password flow (owner decision 2026-09-26)

The whole site sits behind ONE shared password. `POST /api/auth {"password": ...}`
compares with `hmac.compare_digest` against `SITE_PASSWORD` (env var, default
`sibbamala` — never hardcoded beyond that default) and returns an opaque
`secrets.token_hex` session token kept in-memory (12 h TTL). Wrong passwords are
rate-limited per IP with a parallel-safe sliding-window counter (max 5 failures
per 60 s, advanced atomically under a lock — extra connections cannot bypass it)
and return 429 when the limit trips, 403 otherwise. Every persons /
registrations / rsvp-replies endpoint requires `Authorization: Bearer <token>`
(401 without). The frontend stores the token in sessionStorage, shows the password
screen first, and returns to it on any 401 (verified: teddy/api.js `_request`
clears the token and calls `onUnauthorized` on 401, so a server restart — which
wipes the in-memory sessions — sends visitors back to the password screen
gracefully).

## Admin flow (owner decision 2026-09-26, DA fix round 1)

`ADMIN_PASSWORD` env, owner-approved default "grisfest" (2026-09-26).
`POST /api/admin/auth {"password"}` returns a separate admin session token
(own in-memory store; admin tokens also satisfy the site-token check). Admin
token is required for: GET/PUT/DELETE on registrations, GET /api/rsvp-replies,
POST/PUT/DELETE on persons, and POST /api/admin/import-family (replace-all
family import for a running deployment — the gitignored data/family.json is
pushed to the endpoint as JSON, never committed to the repo). The site password remains enough for GET tree
data and the open RSVP endpoint. `/docs`, `/redoc` and `/openapi.json` are
disabled unless `SLAKTTRAFF_DEBUG=1`.

## Data store

Single SQLite file: `data/slakttraff.db` locally, `$STATE_DIRECTORY/slakttraff.db` on vm106 (the app dir is read-only there). Migrations run at startup
(`app/migrations.py`, `run_startup_migrations()`); `Base.metadata.create_all`
at import, then `seed_persons_if_empty()` seeds the family tree from
`data/family.json` once (empty tree + log warning if that file is missing).
Known limitation: duplicate registration emails are accepted and create one
tree spot per registration — no dedup exists by design.

## RSVP model (owner decisions 2026-09-25 + 2026-09-26)

POST /api/persons/{id}/rsvp takes `{"status": "accepted"|"declined", "email": ...,
"phone"?, "notes"?}` with a valid session token. `pending` and unknown values → 422;
missing/invalid email → 422; unknown person → 404. Each reply is stored as an
RsvpReply row — one row per person (upsert: a repeat submit updates the
existing row). Contact info is exposed ONLY via GET /api/rsvp-replies, which
requires an ADMIN token (401 with a mere site token; the admin surface always
exists — `ADMIN_PASSWORD` only overrides the owner-approved default, a921b50).
Spot colours: green = accepted, red = declined, original = pending.

## Known accepted risks (owner decisions 2026-09-26)

- Session tokens are in-memory: a server restart logs everyone out (acceptable for
  this event site; revisit if persistence is wanted).
- The default site password is public in this repo (owner-accepted, shared with
  invitees); set `SITE_PASSWORD` in the host environment to override it. The admin
  view (contact info + person editing) is always enabled; `ADMIN_PASSWORD` only
  overrides its owner-approved default (a921b50).
- RSVP and the registration form both record attendance in separate tables
  (RsvpReply vs Registration) and are not reconciled: RSVP = per-spot answer for
  invited family, registration = general sign-up.
- `teddy/48.*` files are dispatch artifacts, not product code.
