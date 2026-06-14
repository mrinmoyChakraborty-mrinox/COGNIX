from datetime import datetime, timezone
from typing import Optional, Literal

from pydantic import BaseModel, Field, field_validator


class Customer(BaseModel):
    id: str
    name: str
    email: str
    created_at: datetime
    ticket_count: int = 0
    frustration_score: int = 0
    last_seen: Optional[datetime] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError(f"Invalid email format: {v}")
        return v

    @field_validator("frustration_score")
    @classmethod
    def validate_frustration(cls, v: int) -> int:
        if v < 0 or v > 100:
            raise ValueError("frustration_score must be between 0 and 100")
        return v


class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Ticket(BaseModel):
    id: str
    customer_id: str
    subject: str
    status: Literal["open", "resolved", "escalated"]
    created_at: datetime
    resolved_at: Optional[datetime] = None


class MemoryEntry(BaseModel):
    id: str
    customer_id: str
    content: str
    context: str
    memory_type: Literal["world_fact", "experience", "observation"]
    created_at: datetime


class SupportRequest(BaseModel):
    customer_id: str
    message: str

    @field_validator("message")
    @classmethod
    def validate_message(cls, v: str) -> str:
        if len(v.strip()) < 1:
            raise ValueError("message must be at least 1 character")
        if len(v) > 2000:
            raise ValueError("message must not exceed 2000 characters")
        return v.strip()


class SupportResponse(BaseModel):
    response: str
    customer_name: str
    retrieved_memories: list[MemoryEntry]
    memory_saved: bool
    frustration_score: int
    escalation_flag: bool
    suggested_solution: Optional[str] = None


class CreateCustomerRequest(BaseModel):
    name: str
    email: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError(f"Invalid email format: {v}")
        return v
