"""Person schemas for Släktträff 2026."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.enums import Generation, RsvpStatus


class PersonBase(BaseModel):
    """Shared fields for all Person models."""

    name: str = Field(..., min_length=1, max_length=200, description="Full name")
    birth_year: Optional[int] = Field(None, ge=1900, le=2100, description="Birth year (optional)")
    generation: Generation = Field(..., description="Generation number (1-5)")
    role: str = Field(default="Medlem", max_length=100, description="Role in the family tree")
    relation: Optional[str] = Field(None, max_length=200, description="Relationship description")
    description: Optional[str] = Field(None, max_length=500, description="Free-text description")

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip()


class PersonCreate(PersonBase):
    """Input schema for creating a Person."""

    parents: list[int] = Field(default_factory=list, description="Parent person IDs")
    children: list[int] = Field(default_factory=list, description="Child person IDs")
    spouses: list[int] = Field(default_factory=list, description="Spouse person IDs")


class PersonUpdate(BaseModel):
    """Partial update schema for Person (all fields optional)."""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    birth_year: Optional[int] = Field(None, ge=1900, le=2100)
    generation: Optional[Generation] = None
    role: Optional[str] = Field(None, max_length=100)
    relation: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    parents: Optional[list[int]] = None
    children: Optional[list[int]] = None
    spouses: Optional[list[int]] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip() if v else v


class Person(PersonBase):
    """Full Person model with ID, relationships and RSVP state."""

    id: int = Field(..., description="Unique person ID")
    parents: list[int] = Field(default_factory=list, description="Parent person IDs")
    children: list[int] = Field(default_factory=list, description="Child person IDs")
    spouses: list[int] = Field(default_factory=list, description="Spouse person IDs")
    rsvp_status: RsvpStatus = Field(default=RsvpStatus.PENDING, description="RSVP state")

    model_config = {"frozen": True}


class PersonResponse(Person):
    """API response schema for a Person (includes timestamps)."""

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), description="Creation timestamp"
    )
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")


class RsvpSubmit(BaseModel):
    """Input schema for the RSVP endpoint (password-gated click-and-answer)."""

    status: RsvpStatus = Field(..., description="accepted or declined")
    email: EmailStr = Field(..., max_length=300, description="Contact email address")
    phone: Optional[str] = Field(None, max_length=50, description="Optional phone number")
    notes: Optional[str] = Field(
        None, max_length=1000, description="Optional notes (allergies, questions, ...)"
    )


class RsvpReplyResponse(BaseModel):
    """API response schema for a stored RSVP reply (admin view only)."""

    id: int
    person_id: int
    status: str
    email: str
    phone: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"frozen": True}


class ChangeLogResponse(BaseModel):
    """API response schema for a change-log entry (admin view only)."""

    id: int
    person_id: int
    person_name: str
    action: str
    old_status: Optional[str] = None
    new_status: str
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"frozen": True}
