# ============================================================
# repositories/ticket_repository.py
# ============================================================
# Supabase-backed ticket persistence.
#
# Expected Supabase table DDL:
#
#   create table tickets (
#     id           text primary key,
#     customer_id  text not null references customers(id) on delete cascade,
#     subject      text not null,
#     status       text not null default 'open',
#     created_at   timestamptz not null default now(),
#     resolved_at  timestamptz
#   );
#
#   create index tickets_customer_id_idx on tickets(customer_id);
#
# Run this SQL in the Supabase SQL editor before use.
# Status values: 'open' | 'resolved' | 'escalated'
# ============================================================

import os
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from supabase import acreate_client, AsyncClient

from models import Ticket

logger = logging.getLogger("cognix.ticket_repo")

# ── client singleton ─────────────────────────────────────────
# Shares the same pattern as customer_repository — one async
# Supabase client per process, initialised lazily.

_client: Optional[AsyncClient] = None


async def _get_client() -> AsyncClient:
    global _client
    if _client is not None:
        return _client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")

    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY must be set in .env. "
            "Set USE_MOCK_DATA=true to run without Supabase."
        )

    _client = await acreate_client(url, key)
    logger.info("Supabase async client (tickets) initialised | url=%s", url)
    return _client


# ── helpers ──────────────────────────────────────────────────

def _row_to_ticket(row: dict) -> Ticket:
    """Map a raw Supabase row dict → Ticket model."""
    return Ticket(
        id=row["id"],
        customer_id=row["customer_id"],
        subject=row["subject"],
        status=row["status"],
        created_at=_parse_ts(row.get("created_at")),
        resolved_at=_parse_ts(row["resolved_at"]) if row.get("resolved_at") else None,
    )


def _parse_ts(value) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return datetime.now(timezone.utc)


def _new_ticket_id() -> str:
    return f"tkt_{uuid4().hex[:12]}"


# ── public interface ─────────────────────────────────────────

async def get_tickets(customer_id: str) -> list[Ticket]:
    """
    Return all tickets for a customer, newest first.
    Used by GET /customers/{customer_id}/tickets.
    """
    try:
        client = await _get_client()
        resp = (
            await client.table("tickets")
            .select("*")
            .eq("customer_id", customer_id)
            .order("created_at", desc=True)
            .execute()
        )
        tickets = [_row_to_ticket(row) for row in (resp.data or [])]
        logger.info(
            "get_tickets | customer_id=%s | count=%d",
            customer_id, len(tickets),
        )
        return tickets

    except Exception as exc:
        logger.error(
            "get_tickets failed | customer_id=%s | error=%s",
            customer_id, exc, exc_info=True,
        )
        raise


async def get_ticket(ticket_id: str) -> Optional[Ticket]:
    """Fetch a single ticket by id. Returns None if not found."""
    try:
        client = await _get_client()
        resp = (
            await client.table("tickets")
            .select("*")
            .eq("id", ticket_id)
            .maybe_single()
            .execute()
        )
        if resp.data is None:
            logger.warning("Ticket not found | ticket_id=%s", ticket_id)
            return None
        return _row_to_ticket(resp.data)

    except Exception as exc:
        logger.error(
            "get_ticket failed | ticket_id=%s | error=%s",
            ticket_id, exc, exc_info=True,
        )
        raise


async def create_ticket(customer_id: str, subject: str) -> Ticket:
    """
    Insert a new open ticket for the customer.
    Also calls increment_ticket_count so the customer row stays in sync.
    Import increment_ticket_count lazily to avoid circular imports.
    """
    try:
        client  = await _get_client()
        now     = datetime.now(timezone.utc).isoformat()
        new_id  = _new_ticket_id()

        payload = {
            "id":          new_id,
            "customer_id": customer_id,
            "subject":     subject,
            "status":      "open",
            "created_at":  now,
            "resolved_at": None,
        }

        resp = (
            await client.table("tickets")
            .insert(payload)
            .execute()
        )

        if not resp.data:
            raise RuntimeError("Supabase insert returned no data for ticket")

        ticket = _row_to_ticket(resp.data[0])
        logger.info(
            "Ticket created | ticket_id=%s | customer_id=%s",
            ticket.id, customer_id,
        )

        # Keep customer.ticket_count accurate
        try:
            from repositories.customer_repository import increment_ticket_count
            await increment_ticket_count(customer_id)
        except Exception as inc_exc:
            # Non-fatal — ticket is created, count sync can lag
            logger.warning(
                "increment_ticket_count failed after create_ticket | error=%s", inc_exc
            )

        return ticket

    except Exception as exc:
        logger.error(
            "create_ticket failed | customer_id=%s | error=%s",
            customer_id, exc, exc_info=True,
        )
        raise


async def resolve_ticket(ticket_id: str) -> Ticket:
    """
    Mark a ticket as resolved and set resolved_at to now.
    Raises ValueError if the ticket is not found.
    """
    try:
        client      = await _get_client()
        resolved_at = datetime.now(timezone.utc).isoformat()

        resp = (
            await client.table("tickets")
            .update({"status": "resolved", "resolved_at": resolved_at})
            .eq("id", ticket_id)
            .execute()
        )

        if not resp.data:
            raise ValueError(f"Ticket '{ticket_id}' not found or already resolved")

        ticket = _row_to_ticket(resp.data[0])
        logger.info("Ticket resolved | ticket_id=%s", ticket_id)
        return ticket

    except ValueError:
        raise
    except Exception as exc:
        logger.error(
            "resolve_ticket failed | ticket_id=%s | error=%s",
            ticket_id, exc, exc_info=True,
        )
        raise


async def escalate_ticket(ticket_id: str) -> Ticket:
    """
    Mark a ticket as escalated.
    Escalated tickets are surfaced in the agent dashboard with a warning.
    Does NOT set resolved_at — escalated ≠ resolved.
    Raises ValueError if the ticket is not found.
    """
    try:
        client = await _get_client()

        resp = (
            await client.table("tickets")
            .update({"status": "escalated"})
            .eq("id", ticket_id)
            .execute()
        )

        if not resp.data:
            raise ValueError(f"Ticket '{ticket_id}' not found")

        ticket = _row_to_ticket(resp.data[0])
        logger.info("Ticket escalated | ticket_id=%s", ticket_id)
        return ticket

    except ValueError:
        raise
    except Exception as exc:
        logger.error(
            "escalate_ticket failed | ticket_id=%s | error=%s",
            ticket_id, exc, exc_info=True,
        )
        raise


async def get_open_ticket_count(customer_id: str) -> int:
    """
    Return the number of open (non-resolved, non-escalated) tickets.
    Used by the frustration score computation in main.py.

    Supabase PostgREST supports count via the 'exact' header option.
    """
    try:
        client = await _get_client()
        resp = (
            await client.table("tickets")
            .select("id", count="exact")
            .eq("customer_id", customer_id)
            .eq("status", "open")
            .execute()
        )
        count = resp.count or 0
        logger.info(
            "get_open_ticket_count | customer_id=%s | open=%d",
            customer_id, count,
        )
        return count

    except Exception as exc:
        logger.error(
            "get_open_ticket_count failed | customer_id=%s | error=%s",
            customer_id, exc, exc_info=True,
        )
        return 0