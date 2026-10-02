"""Admin-only RSVP reply listing (contact info submitted with RSVPs)."""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_admin_token
from app.database import get_db
from app.models.rsvp_reply import RsvpReply
from app.schemas.person import RsvpReplyResponse

router = APIRouter(
    prefix="/api/rsvp-replies",
    tags=["rsvp-replies"],
    dependencies=[Depends(require_admin_token)],
)


@router.get("/", response_model=List[RsvpReplyResponse])
def list_rsvp_replies(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    """Contact info for every RSVP reply. Admin token required (401 when
    a mere site token is rejected)."""
    return db.query(RsvpReply).order_by(RsvpReply.id).offset(skip).limit(limit).all()
