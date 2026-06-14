"""
agent.py — AI Orchestration Layer for COGNIX
Uses PydanticAI and Groq to manage memory-aware customer support.
"""

import os
import sys
import json
import logging
from typing import Optional, Any, Dict, List
from dotenv import load_dotenv
from pydantic import BaseModel, Field

# Ensure models can be imported from same directory if run directly
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from models import Customer, MemoryEntry
from memory import retrieve_memories, save_memory, reflect, ensure_bank

from pydantic_ai import Agent, RunContext
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.providers.groq import GroqProvider

# ── logging ──────────────────────────────────────────────────
logger = logging.getLogger("cognix.agent")

# ── PydanticAI Initialization ────────────────────────────────
load_dotenv()

groq_api_key = os.getenv("GROQ_API_KEY")

if not groq_api_key:
    raise ValueError(
        "GROQ_API_KEY not found. Please add it to your .env file."
    )

model = GroqModel(
    "GPT-OSS-120B",
    provider=GroqProvider(api_key=groq_api_key)
)

agent = Agent(model)


# ── System Prompt ────────────────────────────────────────────
@agent.system_prompt
def get_system_prompt() -> str:
    """
    Registers the system prompt for the customer support role.
    """
    return (
        "Role: Senior Customer Support Agent with Long-Term Memory\n\n"
        "Rules:\n"
        "- Use memory when relevant\n"
        "- Never invent customer history\n"
        "- Be empathetic\n"
        "- Be concise\n"
        "- Prioritize resolution\n"
        "- Detect escalation risk\n"
        "- Generate memory summaries"
    )


# ── Structured Output Models ────────────────────────────────
class FrustrationAnalysisResult(BaseModel):
    score: int = Field(description="Frustration score between 0 and 100")
    label: str = Field(description="One of: Calm, Mild, Frustrated, Highly Frustrated")


class EscalationAnalysisResult(BaseModel):
    escalate: bool = Field(description="Whether the ticket should be escalated")
    reason: str = Field(description="Reason for the decision")


class SolutionSuggestionResult(BaseModel):
    root_cause: str = Field(description="Root cause of the issue")
    recommended_action: str = Field(description="Recommended action for the support team or customer")
    support_resolution: str = Field(description="Proposed support resolution steps")


# ── Heuristic Fallbacks ──────────────────────────────────────
def _has_keyword(text: str, patterns: List[str]) -> bool:
    """
    Checks if a pattern exists in the text as a separate word/phrase.
    """
    import re
    for pattern in patterns:
        if re.search(r'\b' + re.escape(pattern) + r'\b', text):
            return True
    return False


def fallback_analyze_frustration(message: str) -> Dict[str, Any]:
    """
    Fallback frustration analysis using keyword matching.
    """
    msg_lower = message.lower()
    score = 10
    
    angry_keywords = ["terrible", "worst", "sucks", "broken", "fail", "useless", "garbage", "waste", "hate", "angry", "furious", "unacceptable", "ruined"]
    mild_keywords = ["issue", "error", "problem", "bug", "timeout", "times out", "time out", "wrong", "cannot", "help", "please", "why"]
    legal_keywords = ["legal", "sue", "lawyer", "attorney", "court", "threat"]
    refund_keywords = ["refund", "money back", "cancel", "dispute", "chargeback"]
    
    if (_has_keyword(msg_lower, angry_keywords) or 
            _has_keyword(msg_lower, legal_keywords) or 
            _has_keyword(msg_lower, refund_keywords)):
        score = 85
    elif _has_keyword(msg_lower, mild_keywords):
        score = 50
    elif len(message) > 500:
        score = 40
        
    if score >= 85:
        label = "Highly Frustrated"
    elif score >= 60:
        label = "Frustrated"
    elif score >= 30:
        label = "Mild"
    else:
        label = "Calm"
        
    return {"score": score, "label": label}


def fallback_detect_escalation(message: str, frustration_score: int) -> Dict[str, Any]:
    """
    Fallback escalation detection using frustration score and keyword matching.
    """
    msg_lower = message.lower()
    escalate = False
    reasons = []
    
    if frustration_score > 70:
        escalate = True
        reasons.append("high frustration score")
    if _has_keyword(msg_lower, ["again", "third time", "repeated", "still not", "still having"]):
        escalate = True
        reasons.append("repeated failures")
    if _has_keyword(msg_lower, ["legal", "lawyer", "court", "attorney", "sue", "threat"]):
        escalate = True
        reasons.append("legal threats")
    if _has_keyword(msg_lower, ["refund", "dispute", "cancel", "chargeback", "money back"]):
        escalate = True
        reasons.append("refund disputes")
    if _has_keyword(msg_lower, ["angry", "furious", "pissed", "ridiculous", "worst"]):
        escalate = True
        reasons.append("angry customer language")
        
    if escalate:
        reason = f"Escalated due to: {', '.join(reasons)}."
    else:
        reason = "No escalation trigger detected."
        
    return {"escalate": escalate, "reason": reason}


def fallback_suggest_solution(message: str, context: str = "") -> Dict[str, Any]:
    """
    Fallback solution suggestion using keyword heuristics.
    """
    msg_lower = message.lower()
    root_cause = "Unknown application error or customer inquiry."
    recommended_action = "Assigned support agent to review client details."
    support_resolution = "Investigate the query and reply with standard solutions."
    
    if "password" in msg_lower or "login" in msg_lower or "signin" in msg_lower:
        root_cause = "Credential verification issue or outdated credentials cache."
        recommended_action = "Reset password, clear local cache, and attempt sign-in again."
        support_resolution = "Send password reset link and check user active status in database."
    elif "timeout" in msg_lower or "latency" in msg_lower or "slow" in msg_lower:
        root_cause = "API endpoint latency or high network concurrency."
        recommended_action = "Check server load, verify client network connection, and retry request."
        support_resolution = "Adjust timeout settings and optimize query execution on database."
    elif "billing" in msg_lower or "invoice" in msg_lower or "card" in msg_lower or "payment" in msg_lower:
        root_cause = "Payment processor communication failure or expired billing info."
        recommended_action = "Verify credit card details and check transaction logs."
        support_resolution = "Re-try transaction or prompt client to update payment method."
        
    return {
        "root_cause": root_cause,
        "recommended_action": recommended_action,
        "support_resolution": support_resolution
    }


def fallback_generate_memory_summary(message: str, response: str) -> str:
    """
    Fallback memory summary generation.
    """
    msg_clean = message.replace('\n', ' ').strip()
    resp_clean = response.replace('\n', ' ').strip()
    return f"Customer reported: {msg_clean[:100]}. Resolution: {resp_clean[:120]}."


# ── Public Functions ─────────────────────────────────────────

def build_customer_context(
    customer: Customer,
    memories: List[MemoryEntry],
    message: str,
    reflection: str
) -> str:
    """
    Builds structured prompt containing customer profile, memory, reflection,
    and agent instructions.
    """
    memories_str = ""
    if memories:
        for idx, m in enumerate(memories, 1):
            memories_str += f"- [{m.memory_type}] {m.content} (Context: {m.context})\n"
    else:
        memories_str = "No retrieved memories.\n"

    return (
        "Customer Profile\n"
        f"Customer Name: {customer.name}\n"
        f"Customer ID: {customer.id}\n"
        f"Ticket Count: {customer.ticket_count}\n"
        f"Frustration Score: {customer.frustration_score}\n\n"
        "Past Memory Context\n"
        f"Retrieved Memories:\n{memories_str}\n"
        f"Reflection Result:\n{reflection or 'No prior reflection.'}\n\n"
        "Current Customer Message:\n"
        f"{message}\n\n"
        "Agent Instructions:\n"
        "- Act as a Senior Customer Support Agent with Long-Term Memory.\n"
        "- Use retrieved memories when relevant; avoid asking customer to repeat information they have already provided.\n"
        "- Never invent or assume customer history that is not documented.\n"
        "- Be empathetic, supportive, and concise in your communication.\n"
        "- Prioritize resolution of the customer's issue.\n"
        "- Detect if the ticket requires escalation."
    )


async def analyze_frustration(message: str) -> Dict[str, Any]:
    """
    Analyzes customer sentiment and returns frustration score and label.
    """
    logger.info("Running frustration analysis")
    if not message:
        return {"score": 0, "label": "Calm"}

    try:
        prompt = (
            f"Analyze the frustration level in the following customer message:\n"
            f"\"\"\"\n{message}\n\"\"\"\n\n"
            f"Provide a frustration score between 0 and 100 and select one of the following labels "
            f"based on the score:\n"
            f"- Calm (score 0-29)\n"
            f"- Mild (score 30-59)\n"
            f"- Frustrated (score 60-84)\n"
            f"- Highly Frustrated (score 85-100)"
        )
        response = await agent.run(prompt, output_type=FrustrationAnalysisResult)
        result = response.output
        score = max(0, min(100, int(result.score)))
        label = result.label if result.label in ["Calm", "Mild", "Frustrated", "Highly Frustrated"] else "Calm"
        logger.info("Frustration analysis result: score=%d, label=%s", score, label)
        return {"score": score, "label": label}
    except Exception as exc:
        logger.warning("Frustration analysis failed, using fallback: %s", str(exc))
        fallback = fallback_analyze_frustration(message)
        logger.info("Frustration analysis fallback result: score=%d, label=%s", fallback["score"], fallback["label"])
        return fallback


async def detect_escalation(message: str, frustration_score: int) -> Dict[str, Any]:
    """
    Detects whether a ticket should be escalated.
    """
    logger.info("Running escalation detection")
    try:
        prompt = (
            f"Analyze if this customer ticket should be escalated based on the message and frustration score.\n"
            f"Customer Message: \"\"\"\n{message}\n\"\"\"\n"
            f"Frustration Score: {frustration_score}\n\n"
            f"Escalation triggers include:\n"
            f"- repeated failures\n"
            f"- legal threats\n"
            f"- refund disputes\n"
            f"- angry customer language\n"
            f"- high frustration score (> 70)"
        )
        response = await agent.run(prompt, output_type=EscalationAnalysisResult)
        result = response.output
        logger.info("Escalation decision result: escalate=%s, reason=%s", result.escalate, result.reason)
        return {"escalate": bool(result.escalate), "reason": str(result.reason)}
    except Exception as exc:
        logger.warning("Escalation detection failed, using fallback: %s", str(exc))
        fallback = fallback_detect_escalation(message, frustration_score)
        logger.info("Escalation decision fallback result: escalate=%s, reason=%s", fallback["escalate"], fallback["reason"])
        return fallback


async def generate_memory_summary(message: str, response: str) -> str:
    """
    Generates a memory-friendly summary suitable for storage in Hindsight.
    """
    logger.info("Generating memory summary")
    try:
        prompt = (
            f"Generate a concise, high-density memory-friendly summary of the support interaction "
            f"suitable for long-term storage. Keep it extremely brief and focus on the issue and final resolution.\n\n"
            f"Customer Message: {message}\n"
            f"Agent Response: {response}\n\n"
            f"Example format:\n"
            f"Customer reported recurring login issues after password reset. Resolution was cache clearing and token regeneration."
        )
        res = await agent.run(prompt)
        summary = str(res.output).strip()
        logger.info("Memory summary generated successfully: %s", summary)
        return summary
    except Exception as exc:
        logger.warning("Memory summary generation failed, using fallback: %s", str(exc))
        fallback = fallback_generate_memory_summary(message, response)
        logger.info("Memory summary fallback generated successfully: %s", fallback)
        return fallback


async def suggest_solution(message: str, context: str = "") -> Dict[str, Any]:
    """
    Generates root cause, recommended action, and support resolution.
    """
    logger.info("Running solution suggestion")
    try:
        prompt = (
            f"Propose a solution for this support ticket.\n"
            f"Context: {context}\n"
            f"Customer Message: \"\"\"\n{message}\n\"\"\""
        )
        response = await agent.run(prompt, output_type=SolutionSuggestionResult)
        result = response.output
        return {
            "root_cause": str(result.root_cause),
            "recommended_action": str(result.recommended_action),
            "support_resolution": str(result.support_resolution)
        }
    except Exception as exc:
        logger.warning("Solution suggestion failed, using fallback: %s", str(exc))
        return fallback_suggest_solution(message, context)


async def generate_support_response(
    customer: Customer,
    memories: List[MemoryEntry],
    message: str,
    reflection: str
) -> Dict[str, Any]:
    """
    Generates the final support response and all metadata.
    """
    logger.info("Generating support response for customer %s", customer.id)
    
    # 1. Build context prompt
    context_prompt = build_customer_context(customer, memories, message, reflection)
    
    # 2. Generate support response
    response_text = ""
    try:
        # Ask agent to respond to the customer message with full context
        prompt = (
            f"Use the customer profile, history, and message to generate a helpful support response.\n\n"
            f"{context_prompt}"
        )
        res = await agent.run(prompt)
        response_text = str(res.output).strip()
    except Exception as exc:
        logger.warning("Support response generation failed, using fallback: %s", str(exc))
        # fallback support response
        response_text = (
            f"Hi {customer.name}, thank you for reaching out to COGNIX support. "
            f"I have noted your message regarding this issue. "
            f"Our team is investigating it and we will follow up with you as soon as possible."
        )

    # 3. Analyze frustration
    frust_res = await analyze_frustration(message)
    frustration_score = frust_res["score"]

    # 4. Detect escalation
    esc_res = await detect_escalation(message, frustration_score)
    escalation_flag = esc_res["escalate"]
    escalation_reason = esc_res["reason"] if escalation_flag else None

    # 5. Suggest solution
    sol_res = await suggest_solution(message, context_prompt)
    # Return formatted solution
    suggested_solution = (
        f"Root Cause: {sol_res['root_cause']}\n"
        f"Recommended Action: {sol_res['recommended_action']}\n"
        f"Resolution: {sol_res['support_resolution']}"
    )

    # 6. Generate memory summary
    memory_summary = await generate_memory_summary(message, response_text)

    # 7. Save memory to bank
    await save_memory(customer.id, memory_summary, "support session")

    logger.info(
        "Support response generated successfully | frustration_score=%d | escalation_flag=%s",
        frustration_score,
        escalation_flag
    )

    return {
        "response": response_text,
        "memory_summary": memory_summary,
        "frustration_score": frustration_score,
        "escalation_flag": escalation_flag,
        "escalation_reason": escalation_reason,
        "suggested_solution": suggested_solution
    }


if __name__ == "__main__":
    result = agent.run_sync(
        "Explain the importance of memory systems in AI agents."
    )

    print(result.output)