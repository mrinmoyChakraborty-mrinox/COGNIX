from models import Ticket


async def get_tickets(customer_id: str) -> list[Ticket]:
    return []


async def create_ticket(customer_id: str, subject: str) -> Ticket:
    raise NotImplementedError("Supabase not yet connected")


async def resolve_ticket(ticket_id: str) -> Ticket:
    raise NotImplementedError("Supabase not yet connected")


async def escalate_ticket(ticket_id: str) -> Ticket:
    raise NotImplementedError("Supabase not yet connected")
