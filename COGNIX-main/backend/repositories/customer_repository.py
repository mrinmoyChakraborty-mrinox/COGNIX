# ============================================================
# repositories/customer_repository.py
# ============================================================
# Supabase-backed customer persistence.
#
# Expected Supabase table DDL:
#
#   create table customers (
#     id                text primary key,
#     name              text not null,
#     email             text not null unique,
#     created_at        timestamptz not null default now(),
#     ticket_count      int not null default 0,
#     frustration_score int not null default 0,
#     last_seen         timestamptz
#   );
#
# Run this SQL in the Supabase SQL editor before use.
# ============================================================

import os
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from supabase import acreate_client, AsyncClient

from models import Customer, CreateCustomerRequest

logger = logging.getLogger("cognix.customer_repo")

# ── client singleton ─────────────────────────────────────────

_client: Optional[AsyncClient] = None


async def _get_client() -> AsyncClient:
    """
    Return a shared async Supabase client, initialising on first call.
    acreate_client is the official async constructor from supabase-py v2+.
    """
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
    logger.info("Supabase async client initialised | url=%s", url)
    return _client


# ── helpers ──────────────────────────────────────────────────


def _row_to_customer(row: dict) -> Customer:
    """Map a raw Supabase row dict → Customer model."""
    return Customer(
        id=row["id"],
        name=row["name"],
        email=row["email"],
        created_at=_parse_ts(row.get("created_at")),
        ticket_count=row.get("ticket_count", 0),
        frustration_score=row.get("frustration_score", 0),
        last_seen=_parse_ts(row.get("last_seen")) if row.get("last_seen") else None,
    )


def _parse_ts(value) -> datetime:
    """Parse Supabase ISO timestamp string → datetime (UTC)."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        # Supabase returns e.g. "2025-04-02T14:32:00+00:00"
        return datetime.fromisoformat(value)
    return datetime.now(timezone.utc)


# ── public interface ─────────────────────────────────────────


async def get_customer(customer_id: str) -> Optional[Customer]:
    """
    Fetch a single customer by primary key.
    Returns None (not raises) when not found — callers decide the HTTP response.
    """
    try:
        client = await _get_client()
        resp = (
            await client.table("customers")
            .select("*")
            .eq("id", customer_id)
            .maybe_single()  # returns None instead of raising on 0 rows
            .execute()
        )
        if resp.data is None:
            logger.warning("Customer not found | customer_id=%s", customer_id)
            return None

        customer = _row_to_customer(resp.data)
        logger.info("Customer loaded | customer_id=%s", customer_id)
        return customer

    except Exception as exc:
        logger.error(
            "get_customer failed | customer_id=%s | error=%s",
            customer_id,
            exc,
            exc_info=True,
        )
        raise


async def list_customers() -> list[Customer]:
    """
    Return all customers ordered by creation date (newest first).
    No pagination needed for hackathon scale.
    """
    try:
        client = await _get_client()
        resp = (
            await client.table("customers")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
        customers = [_row_to_customer(row) for row in (resp.data or [])]
        logger.info("list_customers | count=%d", len(customers))
        return customers

    except Exception as exc:
        logger.error("list_customers failed | error=%s", exc, exc_info=True)
        raise


async def create_customer(req: CreateCustomerRequest) -> Customer:
    """
    Insert a new customer row and return the created Customer.

    Generates a uuid4 id here rather than relying on Supabase gen_random_uuid()
    so we can pass the same id immediately to ensure_bank() in main.py
    without a second round-trip to fetch the generated id.
    """
    try:
        client = await _get_client()
        new_id = f"cust_{uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()

        payload = {
            "id": new_id,
            "name": req.name,
            "email": req.email,
            "created_at": now,
            "ticket_count": 0,
            "frustration_score": 0,
        }

        resp = await client.table("customers").insert(payload).execute()

        if not resp.data:
            raise RuntimeError("Supabase insert returned no data")

        customer = _row_to_customer(resp.data[0])
        logger.info(
            "Customer created | customer_id=%s | email=%s",
            customer.id,
            customer.email,
        )
        return customer

    except Exception as exc:
        logger.error(
            "create_customer failed | email=%s | error=%s",
            req.email,
            exc,
            exc_info=True,
        )
        raise


async def update_frustration_score(customer_id: str, score: int) -> bool:
    """
    Update the frustration score for a customer.
    Called after each session where the score is recomputed.
    Score is clamped to [0, 100] before writing.
    """
    clamped = max(0, min(100, score))
    try:
        client = await _get_client()
        await (
            client.table("customers")
            .update({"frustration_score": clamped})
            .eq("id", customer_id)
            .execute()
        )
        logger.info(
            "frustration_score updated | customer_id=%s | score=%d",
            customer_id,
            clamped,
        )
        return True

    except Exception as exc:
        logger.error(
            "update_frustration_score failed | customer_id=%s | error=%s",
            customer_id,
            exc,
            exc_info=True,
        )
        return False


async def increment_ticket_count(customer_id: str) -> bool:
    """
    Atomically increment ticket_count by 1 using Supabase RPC.

    Requires this function in Supabase (run in SQL editor):

        create or replace function increment_ticket_count(cust_id text)
        returns void language sql as $$
          update customers
          set ticket_count = ticket_count + 1
          where id = cust_id;
        $$;
    """
    try:
        client = await _get_client()
        await client.rpc(
            "increment_ticket_count",
            {"cust_id": customer_id},
        ).execute()
        logger.info("ticket_count incremented | customer_id=%s", customer_id)
        return True

    except Exception as exc:
        logger.error(
            "increment_ticket_count failed | customer_id=%s | error=%s",
            customer_id,
            exc,
            exc_info=True,
        )
        return False
