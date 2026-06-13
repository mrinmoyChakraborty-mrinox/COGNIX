from typing import Optional

from models import Ticket


class TicketRepository:
    """Placeholder ticket data access layer. Returns empty results until Supabase is connected."""

    async def get_tickets(self, customer_id: str) -> list[Ticket]:
        return []

    async def create_ticket(self, customer_id: str, subject: str) -> Ticket:
        raise NotImplementedError("Supabase not yet connected")

    async def resolve_ticket(self, ticket_id: str) -> Ticket:
        raise NotImplementedError("Supabase not yet connected")

    async def escalate_ticket(self, ticket_id: str) -> Ticket:
        raise NotImplementedError("Supabase not yet connected")
