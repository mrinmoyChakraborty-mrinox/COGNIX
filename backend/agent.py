# ============================================================
# agent.py — AI Orchestration Layer for COGNIX
# ============================================================
# One structured LLM call per customer message.
# Returns response + frustration + escalation + solution
# in a single Groq round-trip so the demo stays fast.
#
# Falls back to keyword heuristics if the LLM call fails —
# the demo never fully breaks, it just degrades gracefully.
# ============================================================

import os
import re
import logging
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from pydantic_ai import Agent
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.providers.groq import GroqProvider

from models import Customer, MemoryEntry

logger = logging.getLogger("cognix.agent")

load_dotenv()

# ── Model init ───────────────────────────────────────────────

_groq_api_key = os.getenv("GROQ_API_KEY")
if not _groq_api_key:
    raise ValueError("GROQ_API_KEY not found. Add it to your .env file.")

# qwen3-32b is the recommended model from the problem statement.
# It handles structured output and function calling well.
# Fallback: "openai/gpt-4o" if qwen has issues during the hackathon.
_model = GroqModel(
    "qwen/qwen3-32b",
    provider=GroqProvider(api_key=_groq_api_key),
)


# ── Structured output schema ─────────────────────────────────
# One schema, one LLM call, all fields returned together.
# This is the core performance optimisation — 5 calls → 1 call.

class SupportResult(BaseModel):
    """
    Everything the agent produces in a single structured response.
    PydanticAI enforces this schema against the LLM output — if the
    model returns garbage, it retries automatically (up to 3 times).
    """
    response: str = Field(
        description=(
            "The reply sent directly to the customer. "
            "Empathetic, concise, references past history where relevant. "
            "Never asks the customer to repeat information already in memory."
        )
    )
    frustration_score: int = Field(
        description=(
            "Integer 0–100. "
            "0–29 = Calm, 30–59 = Mild, 60–84 = Frustrated, 85–100 = Highly Frustrated."
        ),
        ge=0,
        le=100,
    )
    frustration_label: str = Field(
        description="One of: Calm, Mild, Frustrated, Highly Frustrated"
    )
    escalation_flag: bool = Field(
        description=(
            "True if the ticket needs human escalation. "
            "Trigger on: repeated failures, legal threats, refund disputes, "
            "angry language, frustration_score > 70."
        )
    )
    escalation_reason: Optional[str] = Field(
        default=None,
        description="Why the ticket is being escalated. Null if escalation_flag is false."
    )
    suggested_solution: Optional[str] = Field(
        default=None,
        description=(
            "A concise recommended fix for the agent panel. "
            "One or two sentences max. Null if the issue is unclear."
        )
    )
    memory_summary: str = Field(
        description=(
            "A compact summary of this interaction for long-term storage. "
            "Max 150 chars. Format: 'Customer reported X. Resolved/suggested Y.' "
            "This will be stored in Hindsight — make it dense and searchable."
        )
    )


# ── Agent ────────────────────────────────────────────────────

_agent = Agent(
    _model,
    output_type=SupportResult,
    system_prompt=(
        "You are a senior customer support agent with access to the customer's "
        "full support history. Your job is to resolve issues, not ask customers "
        "to repeat themselves.\n\n"
        "Rules:\n"
        "- Use retrieved memories to infer context from vague messages.\n"
        "- Never invent history that is not in the provided memories.\n"
        "- Be empathetic but concise — customers want resolution, not sympathy.\n"
        "- Escalate proactively if you see risk signals.\n"
        "- Write memory_summary as if it will be read by a support agent "
        "6 months from now who has never seen this conversation."
    ),
)


# ── Context builder ──────────────────────────────────────────

def _build_prompt(
    customer: Customer,
    memories: list[MemoryEntry],
    message: str,
    reflection: str,
) -> str:
    """
    Build the full prompt sent to the LLM.
    Structured in layers: company context → customer profile →
    retrieved memories → reflection → current message.
    This hierarchy is what makes responses feel informed rather
    than generic.
    """
    # Format memory entries
    if memories:
        memory_lines = "\n".join(
            f"  [{m.memory_type.upper()}] {m.content}  (context: {m.context})"
            for m in memories
        )
    else:
        memory_lines = "  No prior memories found for this customer."

    # Format reflection
    reflection_text = reflection.strip() if reflection else "No reflection available."

    return (
        "=== CUSTOMER PROFILE ===\n"
        f"Name:             {customer.name}\n"
        f"ID:               {customer.id}\n"
        f"Tickets so far:   {customer.ticket_count}\n"
        f"Frustration:      {customer.frustration_score}/100 (prior sessions)\n\n"

        "=== RETRIEVED MEMORIES (from Hindsight) ===\n"
        f"{memory_lines}\n\n"

        "=== HINDSIGHT REFLECTION ===\n"
        f"{reflection_text}\n\n"

        "=== CURRENT CUSTOMER MESSAGE ===\n"
        f"{message}\n\n"

        "=== YOUR TASK ===\n"
        "Respond to the customer's message using all available context above. "
        "Fill every field in the structured output. "
        "If the message is vague (e.g. 'same issue as before'), use the memories "
        "to infer what they mean and reference it explicitly in your response."
    )


# ── Fallbacks ────────────────────────────────────────────────
# These run if the LLM call fails completely (network error,
# model timeout, quota exceeded). The demo degrades gracefully
# rather than crashing.

def _kw(text: str, patterns: list[str]) -> bool:
    """Whole-word keyword match, case-insensitive."""
    t = text.lower()
    return any(re.search(r'\b' + re.escape(p) + r'\b', t) for p in patterns)


def _fallback_result(customer: Customer, message: str) -> SupportResult:
    """
    Keyword-heuristic fallback. Produces a plausible SupportResult
    without any LLM call. Used when Groq is unavailable.
    """
    msg = message.lower()

    # Frustration score
    if _kw(msg, ["terrible","worst","sucks","broken","useless","hate","furious","sue","lawyer","refund","cancel"]):
        score, label = 85, "Highly Frustrated"
    elif _kw(msg, ["issue","error","problem","bug","timeout","wrong","cannot","help"]):
        score, label = 50, "Mild"
    else:
        score, label = 15, "Calm"

    # Escalation
    escalate = score >= 85 or _kw(msg, ["again","third time","repeated","still not","legal","sue","refund","dispute"])
    esc_reason = "Escalation triggered by heuristic fallback — review manually." if escalate else None

    # Suggested solution
    if _kw(msg, ["password","login","signin","sign in"]):
        solution = "Reset password and clear session cache."
    elif _kw(msg, ["timeout","slow","latency","ingest"]):
        solution = "Increase payload size limit in SDK config (try max_payload_size='10mb')."
    elif _kw(msg, ["billing","invoice","payment","card"]):
        solution = "Verify payment method and retry transaction."
    else:
        solution = None

    return SupportResult(
        response=(
            f"Hi {customer.name}, thank you for reaching out. "
            "I've reviewed your history and I'm looking into this now. "
            "I'll follow up shortly with a resolution."
        ),
        frustration_score=score,
        frustration_label=label,
        escalation_flag=escalate,
        escalation_reason=esc_reason,
        suggested_solution=solution,
        memory_summary=(
            f"Customer reported: {message[:80].strip()}. "
            "Fallback response sent — awaiting agent follow-up."
        ),
    )


# ── Public API ───────────────────────────────────────────────

async def generate_support_response(
    customer: Customer,
    memories: list[MemoryEntry],
    message: str,
    reflection: str,
) -> SupportResult:
    """
    Main entry point called from main.py.

    Returns a SupportResult with everything needed for:
    - The customer's chat reply        (result.response)
    - The agent panel                  (result.frustration_score, escalation_flag)
    - The memory delta card            (result.memory_summary)
    - The suggested solution pill      (result.suggested_solution)

    Memory is NOT saved here — that's main.py's responsibility.
    This function only generates; main.py persists.
    """
    prompt = _build_prompt(customer, memories, message, reflection)

    try:
        result = await _agent.run(prompt)
        output = result.output

        # Clamp frustration score in case the model drifts outside bounds
        output.frustration_score = max(0, min(100, output.frustration_score))

        logger.info(
            "Agent response generated | customer_id=%s | frustration=%d | escalate=%s",
            customer.id,
            output.frustration_score,
            output.escalation_flag,
        )
        return output

    except Exception as exc:
        logger.warning(
            "LLM call failed, using heuristic fallback | customer_id=%s | error=%s",
            customer.id, exc,
        )
        return _fallback_result(customer, message)