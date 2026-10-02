"""SQLAlchemy model for ChangeLog (audit trail of RSVP changes, MC 3928)."""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ChangeLog(Base):
    __tablename__ = "change_logs"

    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=False, index=True)
    person_name = Column(String(200), nullable=False)  # snapshot, Person.name width
    action = Column(String(20), nullable=False)  # "status" | "contact"
    old_status = Column(String(20), nullable=True)
    new_status = Column(String(20), nullable=False)
    email = Column(String(300), nullable=True)  # contact snapshot AFTER submission
    phone = Column(String(50), nullable=True)
    notes = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
