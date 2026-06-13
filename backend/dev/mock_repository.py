"""Mock repository functions for local development.

Swap into main.py by setting USE_MOCK_DATA=true in your .env file.
Uses in-memory dicts from dev.mock_data.
"""

from typing import Optional
from datetime import datetime, timezone

from models import Customer, CreateCustomerRequest, Ticket
from dev.mock_data import MOCK_CUSTOMERS, MOCK_TICKETS


async def get_customer(customer_id: str) -> Optional[Customer]:
    return MOCK_CUSTOMERS.get(customer_id)


async def list_customers() -> list[Customer]:
    return list(MOCK_CUSTOMERS.values())


async def create_customer(req: CreateCustomerRequest) -> Customer:
    customer = Customer(
        id=f"cust_{len(MOCK_CUSTOMERS) + 1:03d}",
        name=req.name,
        email=req.email,
        company=req.company,
        plan=req.plan,
        created_at=datetime.now(timezone.utc),
    )
    MOCK_CUSTOMERS[customer.id] = customer
    MOCK_TICKETS[customer.id] = []
    return customer


async def get_tickets(customer_id: str) -> list[Ticket]:
    return MOCK_TICKETS.get(customer_id, [])


async def create_ticket(customer_id: str, subject: str) -> Ticket:
    existing = MOCK_TICKETS.get(customer_id, [])
    ticket = Ticket(
        id=f"tkt_{len(existing) + 1:04d}",
        customer_id=customer_id,
        subject=subject,
        status="open",
        created_at=datetime.now(timezone.utc),
    )
    if customer_id not in MOCK_TICKETS:
        MOCK_TICKETS[customer_id] = []
    MOCK_TICKETS[customer_id].append(ticket)
    return ticket


async def resolve_ticket(ticket_id: str) -> Ticket:
    for tickets in MOCK_TICKETS.values():
        for ticket in tickets:
            if ticket.id == ticket_id:
                ticket.status = "resolved"
                ticket.resolved_at = datetime.now(timezone.utc)
                return ticket
    raise ValueError(f"Ticket {ticket_id} not found")


async def escalate_ticket(ticket_id: str) -> Ticket:
    for tickets in MOCK_TICKETS.values():
        for ticket in tickets:
            if ticket.id == ticket_id:
                ticket.status = "escalated"
                return ticket
    raise ValueError(f"Ticket {ticket_id} not found")
