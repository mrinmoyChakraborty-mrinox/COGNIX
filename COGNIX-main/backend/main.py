# ============================================================
# COGNIX — Backend
# ============================================================
# Stack: FastAPI · Hindsight Memory · Groq LLM · Supabase
# ------------------------------------------------------------
# Structure:
#   1. Imports & Config
#   2. Logging Setup
#   3. Pydantic Models
#   4. Mock Database Layer
#   5. Service Classes
#      - CustomerService
#      - TicketService
#      - MemoryService
#      - LLMService
#   6. FastAPI App & Middleware
#   7. REST Endpoints
#   8. WebSocket Endpoint
#   9. Demo Endpoint
# ============================================================

import os
import logging
import logging.config
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models import (
    CreateCustomerRequest,
    Customer,
    MemoryEntry,
    SupportRequest,
    SupportResponse,
    Ticket,
)

# ── env ─────────────────────────────────────────────────────

load_dotenv()

# ── logging ──────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("cognix")

# ── repository layer (mock vs real) ─────────────────────────

USE_MOCK = os.getenv("USE_MOCK_DATA", "").lower() in ("true", "1", "yes")

if USE_MOCK:
    from dev.mock_repository import (
        get_customer,
        list_customers,
        create_customer,
        get_tickets,
        create_ticket,
        resolve_ticket,
        escalate_ticket,
        update_frustration_score,
    )

    logger.info("Using mock repositories")
else:
    from repositories.customer_repository import (
        get_customer,
        list_customers,
        create_customer,
        update_frustration_score,
    )
    from repositories.ticket_repository import (
        get_tickets,
        create_ticket,
        resolve_ticket,
        escalate_ticket,
    )

# ── memory & llm layers ──────────────────────────────────────

from memory import (
    retrieve_memories,
    save_memory,
    get_all_memories,
    reflect,
    ensure_bank,
    seed_customer_memory,
    build_retrieval_viz,
)
from llm import generate_response
from agent import generate_support_response

from auth import get_current_user


# ── startup / shutdown ───────────────────────────────────────

REQUIRED_ENV_VARS = [
    "GROQ_API_KEY",
    "HINDSIGHT_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_KEY",
]


def _validate_env() -> list[str]:
    return [k for k in REQUIRED_ENV_VARS if not os.getenv(k)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(
        "\n"
        "+----------------------------------------+\n"
        "|          COGNIX  v1.0.0                |\n"
        "| FastAPI | Hindsight | Groq | Supabase  |\n"
        "+----------------------------------------+\n"
    )
    missing = _validate_env()
    if missing:
        logger.warning(
            "Missing env vars (some features will fall back to mock): %s",
            ", ".join(missing),
        )
    logger.info("COGNIX started — USE_MOCK=%s", USE_MOCK)
    yield
    logger.info("COGNIX shutting down cleanly")


# ── app ──────────────────────────────────────────────────────

app = FastAPI(
    title="COGNIX",
    version="1.0.0",
    description="Customer support agent with persistent Hindsight memory",
    lifespan=lifespan,
)

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── exception handlers ───────────────────────────────────────


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    logger.warning(
        "HTTPException | status=%d | path=%s", exc.status_code, request.url.path
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "http_error",
            "message": exc.detail,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    logger.error("Unhandled exception | path=%s", request.url.path, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": "An unexpected error occurred.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


# ── REST endpoints ───────────────────────────────────────────


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {
            "hindsight": "connected"
            if os.getenv("HINDSIGHT_API_KEY")
            else "not_configured",
            "groq": "connected" if os.getenv("GROQ_API_KEY") else "not_configured",
            "supabase": "connected" if os.getenv("SUPABASE_URL") else "not_configured",
        },
    }


@app.get("/customers", response_model=list[Customer])
async def list_all_customers(user_id: str = Depends(get_current_user)):
    return await list_customers()


@app.post("/customers", response_model=Customer, status_code=status.HTTP_201_CREATED)
async def create_new_customer(
    req: CreateCustomerRequest, user_id: str = Depends(get_current_user)
):
    customer: Customer = await create_customer(req)

    # Provision Hindsight memory bank immediately on customer creation.
    # seed_customer_memory calls ensure_bank internally, so no double call.
    try:
        await seed_customer_memory(
            customer_id=customer.id,
            customer_name=customer.name,
            email=customer.email,
        )
    except Exception:
        # Non-fatal — memory bank will be created lazily on first session.
        logger.warning(
            "Could not seed memory bank at creation time | customer_id=%s", customer.id
        )

    return customer


@app.get("/customers/{customer_id}", response_model=Customer)
async def get_customer_by_id(
    customer_id: str, user_id: str = Depends(get_current_user)
):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return customer


@app.get("/customers/{customer_id}/memories", response_model=list[MemoryEntry])
async def get_customer_memories(
    customer_id: str, user_id: str = Depends(get_current_user)
):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return await get_all_memories(customer_id)


@app.get("/customers/{customer_id}/tickets", response_model=list[Ticket])
async def get_customer_tickets(
    customer_id: str, user_id: str = Depends(get_current_user)
):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return await get_tickets(customer_id)


@app.post("/support/chat", response_model=SupportResponse)
async def support_chat(req: SupportRequest, user_id: str = Depends(get_current_user)):
    customer = await get_customer(req.customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{req.customer_id}' not found"
        )

    # Ensure bank exists (idempotent — safe to call every time)
    await ensure_bank(req.customer_id, customer.name)

    memories, _ = await retrieve_memories(req.customer_id, req.message)
    reflection = await reflect(req.customer_id, req.message)

    # Call centralized support response pipeline
    res = await generate_support_response(
        customer, memories, req.message, reflection
    )

    # Update customer frustration score in DB
    await update_frustration_score(req.customer_id, res["frustration_score"])

    return SupportResponse(
        response=res["response"],
        customer_name=customer.name,
        retrieved_memories=memories,
        memory_saved=True,
        frustration_score=res["frustration_score"],
        escalation_flag=res["escalation_flag"],
        suggested_solution=res["suggested_solution"],
    )


# ── WebSocket ────────────────────────────────────────────────


@app.websocket("/ws/session/{customer_id}")
async def websocket_session(websocket: WebSocket, customer_id: str):
    await websocket.accept()
    logger.info("WebSocket connected | customer_id=%s", customer_id)

    # Validate customer
    customer = await get_customer(customer_id)
    if customer is None:
        await websocket.close(code=4004, reason=f"Customer '{customer_id}' not found")
        return

    # Ensure memory bank exists before any recall/reflect calls
    try:
        await ensure_bank(customer_id, customer.name)
    except Exception:
        logger.warning(
            "Bank provisioning failed on WS connect — proceeding anyway | customer_id=%s",
            customer_id,
        )

    # ── Opening message ──────────────────────────────────────
    # Humble greeting: signal that memory is loaded without being creepy.
    # The wow moment comes AFTER the customer types their first message.
    opening_reflection = await reflect(
        customer_id,
        "Briefly summarise this customer's most recent unresolved issue or concern "
        "in one sentence. If nothing is unresolved, say so.",
    )

    if opening_reflection:
        opening_text = (
            f"Welcome back, {customer.name}.\n\n"
            "I have access to your previous support history and can help "
            "without you needing to repeat details.\n\n"
            f"Quick note from your history: {opening_reflection}\n\n"
            "How can I help you today?"
        )
    else:
        opening_text = (
            f"Welcome back, {customer.name}.\n\n"
            "I have access to your previous support history and can help "
            "without you needing to repeat details.\n\n"
            "How can I help you today?"
        )

    await websocket.send_json({"event": "opening", "data": opening_text})

    # ── Message loop ─────────────────────────────────────────
    try:
        while True:
            raw = await websocket.receive_text()
            message = raw.strip()
            if not message:
                continue

            # Immediate feedback so the customer sees a typing indicator
            await websocket.send_json(
                {
                    "event": "status",
                    "data": "thinking...",
                    "query": message,
                }
            )

            # 1. Retrieve memories — returns (memories, elapsed_ms)
            memories, elapsed_ms = await retrieve_memories(customer_id, message)

            # 2. Build the retrieval visualisation payload and push it
            #    to the agent panel BEFORE the LLM has even finished.
            #    This makes the panel feel live and fast.
            viz = build_retrieval_viz(message, memories, elapsed_ms)
            await websocket.send_json(
                {
                    "event": "memory.update",
                    **viz,  # query, hits, total, retrieval_time_ms
                }
            )

            # 3. Reflect — synthesised summary over all memories
            reflection = await reflect(customer_id, message)

            # 4. Generate support response, save memory, and compute sentiment
            res = await generate_support_response(
                customer, memories, message, reflection
            )
            response_text = res["response"]
            suggested_solution = res["suggested_solution"]
            frustration_score = res["frustration_score"]
            escalation_flag = res["escalation_flag"]

            # Update frustration score in the database
            await update_frustration_score(customer_id, frustration_score)

            # 5. Send reply to frontend
            await websocket.send_json(
                {
                    "event": "chat.reply",
                    "data": response_text,
                    "suggested_solution": suggested_solution,
                    "escalation_flag": escalation_flag,
                    "frustration_score": frustration_score,
                }
            )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected | customer_id=%s", customer_id)
    except Exception as exc:
        logger.error(
            "WebSocket error | customer_id=%s | error=%s",
            customer_id,
            str(exc),
            exc_info=True,
        )
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except Exception:
            pass


# ── Demo endpoint ────────────────────────────────────────────


@app.get("/demo/memory-flow")
async def demo_memory_flow():
    """
    Returns a hardcoded but fully realistic end-to-end pipeline example.
    Exists purely for hackathon demo day — judges can hit this endpoint
    to see the full COGNIX flow without needing a live customer.
    """
    return {
        "demo_note": (
            "This endpoint illustrates the full COGNIX pipeline. "
            "All data below is realistic but pre-computed for demo purposes."
        ),
        "customer": {
            "id": "cust_demo_001",
            "name": "Mrinmoy Chakraborty",
            "email": "mrinmoy@example.com",
            "ticket_count": 3,
            "frustration_score": 68,
        },
        "step_1_customer_message": "same issue as before",
        "step_2_retrieved_memories": [
            {
                "content": "Apr 02 — Customer reported timeout on /ingest endpoint. "
                "Resolved by increasing payload size limit to 10MB.",
                "memory_type": "experience",
                "context": "support session",
                "label": "Experience",
            },
            {
                "content": "Customer environment: Python SDK v2.3.1, Ubuntu 22.04.",
                "memory_type": "world_fact",
                "context": "onboarding",
                "label": "Fact",
            },
            {
                "content": "Customer has escalated twice when issues were unresolved for more than 2 days.",
                "memory_type": "observation",
                "context": "escalation pattern",
                "label": "Observation",
            },
        ],
        "step_2_retrieval_time_ms": 312,
        "step_3_reflect_summary": (
            "Mrinmoy's most recent unresolved concern is a recurring timeout "
            "on the /ingest endpoint. The fix that worked in April was increasing "
            "the payload size limit. He has a history of escalating if not resolved quickly."
        ),
        "step_4_generated_response": (
            "I believe you're referring to the /ingest timeout from April.\n\n"
            "The fix that worked last time was increasing the payload size limit to 10MB "
            "in your SDK config:\n\n"
            "    client = MemSupportClient(max_payload_size='10mb')\n\n"
            "Would you like to try that first, or has something changed in your setup since then?"
        ),
        "step_5_saved_memory": (
            "Customer reported /ingest timeout recurring (Jun 2026). "
            "Agent suggested payload size fix again. Escalation risk: moderate."
        ),
        "step_6_frustration_score": 68,
        "step_7_escalation_flag": False,
        "retrieval_visualisation": {
            "query": "same issue as before",
            "hits": [
                {
                    "content": "Apr 02 — /ingest timeout → payload fix worked",
                    "memory_type": "experience",
                    "label": "Experience",
                },
                {
                    "content": "Python SDK v2.3.1, Ubuntu 22.04",
                    "memory_type": "world_fact",
                    "label": "Fact",
                },
                {
                    "content": "Escalates if unresolved > 2 days",
                    "memory_type": "observation",
                    "label": "Observation",
                },
            ],
            "total": 3,
            "retrieval_time_ms": 312,
        },
    }


# ── entrypoint ───────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
