"""Change-log contract tests (RSVP audit trail, MC 3928)."""
import os
import tempfile
import threading

# Isolate the test DB before app import (same pattern as tests/test_api.py).
_TMPDIR = tempfile.mkdtemp(prefix="slakttraff-test-changelog-")
os.environ["SLAKTTRAFF_DATABASE_URL"] = f"sqlite:///{_TMPDIR}/test.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth as auth_module  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)

SITE_PASSWORD = "sibbamala"  # default; tests run without SITE_PASSWORD set
ADMIN_PASSWORD = "admin-test-pw"


def _auth_headers():
    r = client.post("/api/auth", json={"password": SITE_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


AUTH = _auth_headers()


_ADMIN_PASSWORD_DEFAULT = auth_module.ADMIN_PASSWORD


@pytest.fixture()
def admin():
    """Enable a test admin password; yield admin auth headers; restore default."""
    auth_module.ADMIN_PASSWORD = ADMIN_PASSWORD
    auth_module._admin_tokens.clear()
    yield {"Authorization": "Bearer " + auth_module.issue_admin_token()}
    auth_module.ADMIN_PASSWORD = _ADMIN_PASSWORD_DEFAULT
    auth_module._admin_tokens.clear()


def _new_person(admin, name="Anna Testsson"):
    r = client.post("/api/persons/", json={
        "name": name, "birth_year": 1980, "generation": 2, "role": "Medlem",
    }, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _rsvp(pid, **overrides):
    payload = {"status": "accepted", "email": "anna@example.se",
               "phone": "070-111 22 33", "notes": "Tar med tårta"}
    payload.update(overrides)
    r = client.post(f"/api/persons/{pid}/rsvp", json=payload, headers=AUTH)
    assert r.status_code == 200, r.text
    return r


def _log_rows(admin, pid):
    """This person's change-log rows, newest first (server returns desc)."""
    rows = client.get("/api/admin/change-log", headers=admin).json()
    return [x for x in rows if x["person_id"] == pid]


def test_first_rsvp_logs_one_status_row(admin):
    pid = _new_person(admin)
    _rsvp(pid)
    rows = _log_rows(admin, pid)
    assert len(rows) == 1
    row = rows[0]
    assert row["action"] == "status"
    assert row["old_status"] == "pending"
    assert row["new_status"] == "accepted"
    assert row["person_name"] == "Anna Testsson"
    assert row["email"] == "anna@example.se"
    assert row["phone"] == "070-111 22 33"
    assert row["notes"] == "Tar med tårta"
    assert row["created_at"]


def test_identical_resubmit_logs_nothing(admin):
    pid = _new_person(admin)
    _rsvp(pid)
    before = len(_log_rows(admin, pid))
    _rsvp(pid)  # byte-identical resubmit
    assert len(_log_rows(admin, pid)) == before == 1


def test_status_flip_logs_row(admin):
    pid = _new_person(admin)
    _rsvp(pid)
    _rsvp(pid, status="declined")
    rows = _log_rows(admin, pid)
    assert len(rows) == 2
    assert rows[0]["action"] == "status"
    assert rows[0]["old_status"] == "accepted"
    assert rows[0]["new_status"] == "declined"


def test_status_and_contact_together_logs_one_status_row(admin):
    pid = _new_person(admin)
    _rsvp(pid)
    _rsvp(pid, status="declined", email="ny@example.se",
          phone="070-999 88 77", notes="Vegan")
    rows = _log_rows(admin, pid)
    assert len(rows) == 2  # exactly ONE new row, not two
    assert rows[0]["action"] == "status"
    assert rows[0]["new_status"] == "declined"
    assert rows[0]["email"] == "ny@example.se"
    assert rows[0]["phone"] == "070-999 88 77"
    assert rows[0]["notes"] == "Vegan"


def test_contact_only_change_logs_contact_row(admin):
    pid = _new_person(admin)
    _rsvp(pid)
    _rsvp(pid, email="ny@example.se")  # status unchanged
    rows = _log_rows(admin, pid)
    assert len(rows) == 2
    row = rows[0]
    assert row["action"] == "contact"
    assert row["old_status"] == "accepted"
    assert row["new_status"] == "accepted"
    # snapshot = resulting merged values, not blanks
    assert row["email"] == "ny@example.se"
    assert row["phone"] == "070-111 22 33"
    assert row["notes"] == "Tar med tårta"


def test_change_log_requires_admin_token(admin):
    assert client.get("/api/admin/change-log").status_code == 401
    assert client.get("/api/admin/change-log", headers=AUTH).status_code == 401
    assert client.get("/api/admin/change-log", headers=admin).status_code == 200


def _reply_rows(admin, pid):
    """This person's rsvp_replies rows via the admin view (shape: app/routers/
    rsvp_replies.py -> RsvpReplyResponse, filtered on person_id)."""
    return [x for x in client.get("/api/rsvp-replies/", headers=admin).json()
            if x["person_id"] == pid]


def test_concurrent_identical_submits_log_one_row(admin):
    """Two byte-identical submits released together -> exactly ONE change-log
    row AND exactly ONE reply row (P1: the double-log / duplicate-reply race)."""
    pid = _new_person(admin)
    payload = {"status": "accepted", "email": "anna@example.se",
               "phone": "070-111 22 33", "notes": "Tar med tårta"}
    barrier = threading.Barrier(2)
    errs = []

    def submit():
        try:
            barrier.wait(timeout=5)
            r = client.post(f"/api/persons/{pid}/rsvp", json=payload, headers=AUTH)
            assert r.status_code == 200, r.text
        except Exception as e:  # noqa: BLE001 - surface to the main thread
            errs.append(f"{type(e).__name__}: {e}")

    threads = [threading.Thread(target=submit) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errs, errs
    assert len(_log_rows(admin, pid)) == 1
    assert len(_reply_rows(admin, pid)) == 1


def test_concurrent_distinct_submits_chain(admin):
    """accepted + declined submitted concurrently -> exactly TWO chained rows
    (no phantom transition) and ONE reply row (P1)."""
    pid = _new_person(admin)
    barrier = threading.Barrier(2)
    errs = []

    def submit(status):
        try:
            barrier.wait(timeout=5)
            r = client.post(f"/api/persons/{pid}/rsvp",
                            json={"status": status, "email": "anna@example.se"},
                            headers=AUTH)
            assert r.status_code == 200, r.text
        except Exception as e:  # noqa: BLE001 - surface to the main thread
            errs.append(f"{type(e).__name__}: {e}")

    threads = [threading.Thread(target=submit, args=(s,))
               for s in ("accepted", "declined")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errs, errs

    rows = sorted(_log_rows(admin, pid), key=lambda r: r["id"])  # old->new order
    assert len(rows) == 2
    assert rows[0]["old_status"] == "pending"
    assert rows[1]["old_status"] == rows[0]["new_status"]  # valid chain
    assert {rows[0]["new_status"], rows[1]["new_status"]} == {"accepted", "declined"}
    assert len(_reply_rows(admin, pid)) == 1


def test_change_log_skip_and_limit(admin):
    """skip/limit actually page the newest-first trail (P2: kill the
    offset-no-op and limit-no-op mutations M2/M3)."""
    pid = _new_person(admin, name="Page Testsson")
    _rsvp(pid)                              # row A (oldest)
    _rsvp(pid, email="p2@example.se")       # row B
    _rsvp(pid, email="p3@example.se")       # row C (newest)
    ids = [x["id"] for x in _log_rows(admin, pid)]  # newest first
    assert len(ids) == 3
    newest, middle, oldest = ids

    assert [x["id"] for x in client.get(
        "/api/admin/change-log?limit=1", headers=admin).json()] == [newest]
    page = client.get("/api/admin/change-log?skip=1", headers=admin).json()
    assert middle in [x["id"] for x in page] and oldest in [x["id"] for x in page]
    assert newest not in [x["id"] for x in page]
    assert [x["id"] for x in client.get(
        "/api/admin/change-log?skip=1&limit=1", headers=admin).json()] == [middle]


def test_change_log_newest_first(admin):
    pid = _new_person(admin, name="Olga Testsson")
    _rsvp(pid)
    _rsvp(pid, email="olga2@example.se")
    _rsvp(pid, status="declined")
    ids = [x["id"] for x in _log_rows(admin, pid)]
    assert ids == sorted(ids, reverse=True)
    full = client.get("/api/admin/change-log", headers=admin).json()
    all_ids = [x["id"] for x in full]
    assert all_ids == sorted(all_ids, reverse=True)
