"""Person CRUD + RSVP endpoints."""
import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import require_admin_token, require_token
from app.database import get_db
from app.models.change_log import ChangeLog
from app.models.person import Person
from app.models.rsvp_reply import RsvpReply
from app.schemas.enums import RsvpStatus
from app.schemas.person import PersonCreate, PersonResponse, PersonUpdate, RsvpSubmit

router = APIRouter(
    prefix="/api/persons", tags=["persons"], dependencies=[Depends(require_token)]
)


@router.post("/", response_model=PersonResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_admin_token)])
def create_person(person: PersonCreate, db: Session = Depends(get_db)):
    db_person = Person(
        name=person.name,
        birth_year=person.birth_year,
        generation=person.generation.value,
        role=person.role,
        relation=person.relation,
        description=person.description,
        parents=person.parents,
        children=person.children,
        spouses=person.spouses,
        rsvp_status=RsvpStatus.PENDING.value,
        rsvp_token=secrets.token_urlsafe(24),
    )
    db.add(db_person)
    db.commit()
    db.refresh(db_person)
    return db_person


@router.get("/", response_model=List[PersonResponse])
def list_persons(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(Person).offset(skip).limit(limit).all()


@router.get("/{person_id}", response_model=PersonResponse)
def get_person(person_id: int, db: Session = Depends(get_db)):
    db_person = db.query(Person).filter(Person.id == person_id).first()
    if db_person is None:
        raise HTTPException(status_code=404, detail="Person not found")
    return db_person


@router.put("/{person_id}", response_model=PersonResponse,
            dependencies=[Depends(require_admin_token)])
def update_person(person_id: int, person_update: PersonUpdate, db: Session = Depends(get_db)):
    db_person = db.query(Person).filter(Person.id == person_id).first()
    if db_person is None:
        raise HTTPException(status_code=404, detail="Person not found")

    for field, value in person_update.model_dump(exclude_unset=True).items():
        setattr(db_person, field, value)

    db.commit()
    db.refresh(db_person)
    return db_person


@router.delete("/{person_id}", status_code=status.HTTP_200_OK,
               dependencies=[Depends(require_admin_token)])
def delete_person(person_id: int, db: Session = Depends(get_db)):
    db_person = db.query(Person).filter(Person.id == person_id).first()
    if db_person is None:
        raise HTTPException(status_code=404, detail="Person not found")
    db.delete(db_person)
    db.commit()
    return {"message": "Person deleted"}


def _rsvp_diff(db_person: Person, reply, rsvp: RsvpSubmit):
    """Compare a submission against the stored state BEFORE mutating.

    Returns (old_status, status_changed, contact_changed). With no reply row
    yet, nothing is stored: the person's current rsvp_status is the old
    status and stored contact fields count as None. Values are compared
    exactly as they are stored (the schema already normalises them).
    """
    if reply is None:
        old_status = db_person.rsvp_status
        stored = (None, None, None)
    else:
        old_status = reply.status
        stored = (reply.email, reply.phone, reply.notes)
    status_changed = (old_status or "") != rsvp.status.value
    submitted = (rsvp.email, rsvp.phone, rsvp.notes)
    contact_changed = any(
        (a or "") != (b or "") for a, b in zip(stored, submitted)
    )
    return old_status, status_changed, contact_changed


@router.post("/{person_id}/rsvp", response_model=PersonResponse)
def submit_rsvp(person_id: int, rsvp: RsvpSubmit, db: Session = Depends(get_db)):
    """Accept or decline the invitation, storing the submitted contact info.

    A real change (status or contact) is audit-logged in change_logs; an
    identical resubmit adds no row (MC 3928).
    """
    db_person = db.query(Person).filter(Person.id == person_id).first()
    if db_person is None:
        raise HTTPException(status_code=404, detail="Person not found")
    if rsvp.status == RsvpStatus.PENDING:
        raise HTTPException(status_code=422, detail="RSVP must be accepted or declined")

    reply = db.query(RsvpReply).filter(RsvpReply.person_id == person_id).first()
    old_status, status_changed, contact_changed = _rsvp_diff(db_person, reply, rsvp)

    db_person.rsvp_status = rsvp.status.value
    # Upsert: one reply row per person — a repeat submit updates the existing
    # row instead of accumulating duplicates.
    if reply is None:
        reply = RsvpReply(person_id=person_id)
        db.add(reply)
    reply.status = rsvp.status.value
    reply.email = rsvp.email
    reply.phone = rsvp.phone
    reply.notes = rsvp.notes
    if status_changed or contact_changed:
        db.add(ChangeLog(
            person_id=person_id,
            person_name=db_person.name,
            action="status" if status_changed else "contact",
            old_status=old_status,
            new_status=rsvp.status.value,
            email=reply.email,   # contact snapshot as stored AFTER applying
            phone=reply.phone,
            notes=reply.notes,
        ))
    db.commit()
    db.refresh(db_person)
    return db_person
