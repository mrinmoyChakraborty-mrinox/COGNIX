# ============================================================
# memory.py — Hindsight Cloud integration for COGNIX
# ============================================================
# Handles all memory operations:
#   - Bank creation / provisioning per customer
#   - retain  → store new memories after each session
#   - recall  → retrieve relevant memories for a query
#   - reflect → synthesize a reasoned answer over memories
#
# Bank strategy: one bank per customer (bank_id = customer_id)
# Banks are created lazily on first contact and cached in-process.
# ============================================================

import os
import time
import logging
from datetime import datetime, timezone
from uuid import uuid4

from models import MemoryEntry

logger = logging.getLogger("cognix.memory")

# ── Hindsight client (singleton) ────────────────────────────

_hindsight = None
_bank_cache: set[str] = set()  # tracks which banks we've already created this process


def _get_client():
    """
    Return the shared Hindsight client, initialising it on first call.
    Raises RuntimeError if env vars are missing so the error surfaces
    clearly at startup rather than silently at request time.
    """
    global _hindsight

    if _hindsight is not None:
        return _hindsight

    api_key = os.getenv("HINDSIGHT_API_KEY")
    base_url = os.getenv("HINDSIGHT_BASE_URL", "https://api.hindsight.vectorize.io")

    if not api_key:
        raise RuntimeError(
            "HINDSIGHT_API_KEY is not set. "
            "Add it to your .env file before starting the server."
        )

    from hindsight_client import Hindsight  # noqa: PLC0415 — lazy import

    _hindsight = Hindsight(base_url=base_url, api_key=api_key)
    logger.info("Hindsight client initialised | base_url=%s", base_url)
    return _hindsight


# ── Bank provisioning ────────────────────────────────────────


async def ensure_bank(customer_id: str, customer_name: str = "") -> None:
    """
    Idempotently ensure a memory bank exists for this customer.

    Called:
      - When a customer is first created (POST /customers)
      - On WebSocket connect, as a safety net
      - Before the first recall/retain in a session

    Banks are cached in _bank_cache so create_bank is only called
    once per process lifetime per customer. Hindsight's create_bank
    is itself idempotent — calling it on an existing bank_id is safe —
    but we skip the network round-trip when we can.
    """
    if customer_id in _bank_cache:
        return

    client = _get_client()

    # Background & disposition are set once at bank creation.
    # They shape how reflect() reasons over memories.
    # Empathy=5 → agent weights emotional context heavily (right for support).
    # Skepticism=2 → agent trusts what the customer says (don't second-guess).
    # Literalism=2 → agent reads between the lines (good for "same issue as before").
    background = (
        f"Customer support history for {customer_name or customer_id}. "
        "Tracks past issues, resolutions, and interaction patterns. "
        "Use this context to give informed, personalised support responses "
        "without asking the customer to repeat themselves."
    )

    try:
        await client.acreate_bank(
            bank_id=customer_id,
            name=customer_name or customer_id,
            background=background,
            disposition={
                "skepticism": 2,  # 1–5 scale: 2 = mostly trusting
                "literalism": 2,  # 1–5 scale: 2 = reads context flexibly
                "empathy": 5,  # 1–5 scale: 5 = maximum empathy
            },
        )
        _bank_cache.add(customer_id)
        logger.info("Memory bank created | customer_id=%s", customer_id)
    except Exception as exc:
        # If the bank already exists, Hindsight raises — treat that as success.
        err_str = str(exc).lower()
        if "already exists" in err_str or "conflict" in err_str or "409" in err_str:
            _bank_cache.add(customer_id)
            logger.info(
                "Memory bank already exists, cached | customer_id=%s", customer_id
            )
        else:
            logger.error(
                "Failed to create memory bank | customer_id=%s | error=%s",
                customer_id,
                exc,
                exc_info=True,
            )
            raise


# ── Seed initial memories for a new customer ────────────────


async def seed_customer_memory(
    customer_id: str,
    customer_name: str,
    email: str,
) -> None:
    """
    Called once after a new customer is created.
    Stores baseline world-facts so the agent has something to work with
    from the very first session, even before the customer contacts support.
    """
    client = _get_client()
    await ensure_bank(customer_id, customer_name)

    items = [
        {
            "content": f"Customer name: {customer_name}. Email: {email}.",
            "context": "customer onboarding",
        },
    ]

    try:
        await client.aretain_batch(bank_id=customer_id, items=items)
        logger.info(
            "Seeded baseline memories | customer_id=%s | count=%d",
            customer_id,
            len(items),
        )
    except Exception as exc:
        logger.error(
            "Failed to seed memories | customer_id=%s | error=%s",
            customer_id,
            exc,
            exc_info=True,
        )


# ── recall ───────────────────────────────────────────────────


async def retrieve_memories(
    customer_id: str,
    query: str,
) -> tuple[list[MemoryEntry], int]:
    """
    Retrieve memories relevant to `query` from the customer's bank.

    Returns:
        (memories, elapsed_ms) — the elapsed_ms is passed to the frontend
        so the retrieval visualisation can show "340ms".

    Uses Hindsight's TEMPR strategy (semantic + keyword + graph + temporal)
    so queries like "same issue as before" or "the billing thing in April"
    resolve correctly — not just semantic similarity.
    """
    client = _get_client()
    await ensure_bank(customer_id)

    start = time.time()

    try:
        result = await client.arecall(
            bank_id=customer_id,
            query=query,
            budget="mid",
            include_entities=True,
        )
        elapsed_ms = round((time.time() - start) * 1000)

        memories: list[MemoryEntry] = []
        for m in result.results:
            memories.append(
                MemoryEntry(
                    id=str(uuid4()),
                    customer_id=customer_id,
                    content=m.text,
                    context=getattr(m, "context", None) or "recalled",
                    memory_type=_map_memory_type(getattr(m, "type", "world_fact")),
                    created_at=datetime.now(timezone.utc),
                )
            )

        logger.info(
            "recall complete | customer_id=%s | query=%r | hits=%d | ms=%d",
            customer_id,
            query,
            len(memories),
            elapsed_ms,
        )
        return memories, elapsed_ms

    except Exception as exc:
        elapsed_ms = round((time.time() - start) * 1000)
        logger.error(
            "recall failed | customer_id=%s | error=%s",
            customer_id,
            exc,
            exc_info=True,
        )
        return [], elapsed_ms


def _map_memory_type(hindsight_type: str) -> str:
    """
    Map Hindsight's internal type names to our MemoryEntry literal.
    Hindsight uses: "world", "experience", "observation"
    Our model uses: "world_fact", "experience", "observation"
    """
    mapping = {
        "world": "world_fact",
        "world_fact": "world_fact",
        "experience": "experience",
        "observation": "observation",
    }
    return mapping.get(hindsight_type.lower(), "world_fact")


# ── retain ───────────────────────────────────────────────────


async def save_memory(
    customer_id: str,
    content: str,
    context: str,
    metadata: dict | None = None,
) -> bool:
    """
    Store a new memory in the customer's bank.

    Called after every support interaction so the next session
    can recall what happened this time.

    `metadata` is optional — pass ticket_id, session_id, etc.
    if you want to link memories back to Supabase records later.
    """
    client = _get_client()
    await ensure_bank(customer_id)

    try:
        kwargs: dict = dict(
            bank_id=customer_id,
            content=content,
            context=context,
            timestamp=datetime.now(timezone.utc),
        )
        if metadata:
            kwargs["metadata"] = metadata

        await client.aretain(**kwargs)
        logger.info(
            "retain complete | customer_id=%s | context=%s | chars=%d",
            customer_id,
            context,
            len(content),
        )
        return True

    except Exception as exc:
        logger.error(
            "retain failed | customer_id=%s | error=%s",
            customer_id,
            exc,
            exc_info=True,
        )
        return False


# ── get_all_memories ─────────────────────────────────────────


async def get_all_memories(customer_id: str) -> list[MemoryEntry]:
    """
    Return all memories stored for a customer.
    Used by GET /customers/{customer_id}/memories.
    Paginates up to 200 entries (enough for a hackathon demo).
    """
    client = _get_client()
    await ensure_bank(customer_id)

    try:
        result = await client.alist_memories(bank_id=customer_id, limit=200, offset=0)

        memories: list[MemoryEntry] = []
        for m in result.items:
            memories.append(
                MemoryEntry(
                    id=str(uuid4()),
                    customer_id=customer_id,
                    content=str(m),
                    context="stored",
                    memory_type="world_fact",
                    created_at=datetime.now(timezone.utc),
                )
            )

        logger.info(
            "list_memories | customer_id=%s | total=%d", customer_id, len(memories)
        )
        return memories

    except Exception as exc:
        logger.error(
            "list_memories failed | customer_id=%s | error=%s",
            customer_id,
            exc,
            exc_info=True,
        )
        return []


# ── reflect ──────────────────────────────────────────────────


async def reflect(customer_id: str, query: str) -> str:
    """
    Ask Hindsight to reason over all stored memories and produce
    a synthesised natural-language answer to `query`.

    Used for two things:
      1. Opening greeting — "What is this customer most likely
         contacting support about today?"
      2. Feeding synthesised context into the Groq prompt alongside
         raw recalled memories.

    Uses budget="high" because reflect is the most expensive operation
    and we only call it once per message (not in a loop).
    """
    client = _get_client()
    await ensure_bank(customer_id)

    try:
        response = await client.areflect(
            bank_id=customer_id,
            query=query,
            budget="high",
        )
        logger.info("reflect complete | customer_id=%s | query=%r", customer_id, query)
        return response.text

    except Exception as exc:
        logger.error(
            "reflect failed | customer_id=%s | error=%s",
            customer_id,
            exc,
            exc_info=True,
        )
        return ""


# ── retrieval visualisation payload ──────────────────────────


def build_retrieval_viz(
    query: str,
    memories: list[MemoryEntry],
    elapsed_ms: int,
) -> dict:
    """
    Build the structured payload that the frontend MemoryRetrieval
    component consumes to animate the staggered memory hits.

    Sent as part of the "memory.update" WebSocket event so the
    agent panel can show:

        Query: "same issue as before"
        ✓ Apr 02 — timeout on /ingest    [experience]
        ✓ Fix: payload limit → 10MB      [observation]
        ✓ Python SDK, Ubuntu 22.04       [world_fact]
        4 memories · 340ms

    Structure:
    {
        "query": str,
        "hits": [
            {
                "content": str,
                "memory_type": "world_fact" | "experience" | "observation",
                "context": str,
                "label": str          # human-readable type label
            },
            ...
        ],
        "total": int,
        "retrieval_time_ms": int
    }
    """
    TYPE_LABELS = {
        "world_fact": "Fact",
        "experience": "Experience",
        "observation": "Observation",
    }

    hits = [
        {
            "content": m.content,
            "memory_type": m.memory_type,
            "context": m.context,
            "label": TYPE_LABELS.get(m.memory_type, "Memory"),
        }
        for m in memories
    ]

    return {
        "query": query,
        "hits": hits,
        "total": len(hits),
        "retrieval_time_ms": elapsed_ms,
    }
