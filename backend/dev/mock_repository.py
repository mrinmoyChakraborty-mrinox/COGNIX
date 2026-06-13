"""Mock repository functions for local development.

Swap into main.py by setting USE_MOCK_DATA=true in your .env file.
Builds lookup dicts from the dev.mock_data module at import time.
"""

from typing import Optional
from datetime import datetime, timezone
import random

from models import Customer, CreateCustomerRequest, Ticket
from dev.mock_data import CUSTOMERS, TICKETS

# ── lookup dicts built once at import ─────────────────────────

_MOCK_CUSTOMERS: dict[str, Customer] = {}
_MOCK_TICKETS: dict[str, list[Ticket]] = {}

random.seed(42)


def _compute_frustration(ticket_count: int, resolved_count: int) -> int:
    base = min(ticket_count * 12, 60)
    unresolved_penalty = (ticket_count - resolved_count) * 10
    jitter = random.randint(-8, 8)
    return max(0, min(100, base + unresolved_penalty + jitter))


def _build_customer(d: dict) -> Customer:
    customer_tickets = [
        t for t in TICKETS if t.get("customer_id") == d.get("customer_id")
    ]
    ticket_count = len(customer_tickets)
    resolved_count = sum(1 for t in customer_tickets if t.get("status") == "resolved")
    created = d.get("created_at", "")
    last_seen = d.get("last_seen")

    return Customer(
        id=d["customer_id"],
        name=d["name"],
        email=d.get("email", f"{d['name'].lower().replace(' ', '.')}@example.com"),
        created_at=(
            datetime.fromisoformat(created)
            if isinstance(created, str) and created
            else datetime.now(timezone.utc)
        ),
        ticket_count=ticket_count,
        frustration_score=d.get(
            "frustration_score", _compute_frustration(ticket_count, resolved_count)
        ),
        last_seen=(
            datetime.fromisoformat(last_seen) if isinstance(last_seen, str) else None
        ),
    )


def _build_ticket(d: dict) -> Ticket:
    created = d.get("created_at", "")
    resolved = d.get("resolved_at")
    return Ticket(
        id=d["ticket_id"],
        customer_id=d["customer_id"],
        subject=d.get("title", d.get("subject", "")),
        status=d.get("status", "open"),
        created_at=(
            datetime.fromisoformat(created)
            if isinstance(created, str) and created
            else datetime.now(timezone.utc)
        ),
        resolved_at=(
            datetime.fromisoformat(resolved) if isinstance(resolved, str) else resolved
        ),
    )


def _init():
    for c in CUSTOMERS:
        cust = _build_customer(c)
        _MOCK_CUSTOMERS[cust.id] = cust

    for t in TICKETS:
        tkt = _build_ticket(t)
        cid = tkt.customer_id
        if cid not in _MOCK_TICKETS:
            _MOCK_TICKETS[cid] = []
        _MOCK_TICKETS[cid].append(tkt)


_init()


# ── public interface ─────────────────────────────────────────


async def get_customer(customer_id: str) -> Optional[Customer]:
    return _MOCK_CUSTOMERS.get(customer_id)


async def list_customers() -> list[Customer]:
    return list(_MOCK_CUSTOMERS.values())


async def create_customer(req: CreateCustomerRequest) -> Customer:
    customer = Customer(
        id=f"cust_{len(_MOCK_CUSTOMERS) + 1:03d}",
        name=req.name,
        email=req.email,
        created_at=datetime.now(timezone.utc),
    )
    _MOCK_CUSTOMERS[customer.id] = customer
    _MOCK_TICKETS[customer.id] = []
    return customer


async def get_tickets(customer_id: str) -> list[Ticket]:
    return _MOCK_TICKETS.get(customer_id, [])


async def create_ticket(customer_id: str, subject: str) -> Ticket:
    existing = _MOCK_TICKETS.get(customer_id, [])
    ticket = Ticket(
        id=f"tkt_{len(existing) + 1:04d}",
        customer_id=customer_id,
        subject=subject,
        status="open",
        created_at=datetime.now(timezone.utc),
    )
    if customer_id not in _MOCK_TICKETS:
        _MOCK_TICKETS[customer_id] = []
    _MOCK_TICKETS[customer_id].append(ticket)
    return ticket


async def resolve_ticket(ticket_id: str) -> Ticket:
    for tickets in _MOCK_TICKETS.values():
        for ticket in tickets:
            if ticket.id == ticket_id:
                ticket.status = "resolved"
                ticket.resolved_at = datetime.now(timezone.utc)
                return ticket
    raise ValueError(f"Ticket {ticket_id} not found")


async def escalate_ticket(ticket_id: str) -> Ticket:
    for tickets in _MOCK_TICKETS.values():
        for ticket in tickets:
            if ticket.id == ticket_id:
                ticket.status = "escalated"
                return ticket
    raise ValueError(f"Ticket {ticket_id} not found")
