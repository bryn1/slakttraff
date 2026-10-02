"""Admin-only RSVP change-log listing (audit trail, MC 3928)."""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_admin_token
from app.database import get_db
from app.models.change_log import ChangeLog
from app.schemas.person import ChangeLogResponse

router = APIRouter(
    prefix="/api/admin",
    tags=["change-log"],
    dependencies=[Depends(require_admin_token)],
)


@router.get("/change-log", response_model=List[ChangeLogResponse])
def list_change_log(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    """RSVP audit trail, newest first. Admin token required (a mere site
    token is rejected — require_admin_token enforces)."""
    return (db.query(ChangeLog)
            .order_by(ChangeLog.id.desc())
            .offset(skip)
            .limit(limit)
            .all())
