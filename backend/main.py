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
    ChatRequest,
    CreateCustomerRequest,
    CreateTicketRequest,
    Customer,
    MemoryEntry,
    MyChatRequest,
    MyChatResponse,
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
    )

    logger.info("Using mock repositories")
else:
    from repositories.customer_repository import (
        get_customer,
        list_customers,
        create_customer,
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

from auth import get_current_user, get_supabase_client, require_admin, verify_ws_token


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
async def list_all_customers(_: dict = Depends(require_admin)):
    return await list_customers()


@app.post("/customers", response_model=Customer, status_code=status.HTTP_201_CREATED)
async def create_new_customer(
    req: CreateCustomerRequest, _: dict = Depends(require_admin)
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
async def get_customer_by_id(customer_id: str, _: dict = Depends(require_admin)):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return customer


@app.get("/customers/{customer_id}/memories", response_model=list[MemoryEntry])
async def get_customer_memories(customer_id: str, _: dict = Depends(require_admin)):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return await get_all_memories(customer_id)


@app.get("/customers/{customer_id}/tickets", response_model=list[Ticket])
async def get_customer_tickets(customer_id: str, _: dict = Depends(require_admin)):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return await get_tickets(customer_id)


@app.post("/support/chat", response_model=SupportResponse)
async def support_chat(req: SupportRequest, _: dict = Depends(require_admin)):
    customer = await get_customer(req.customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{req.customer_id}' not found"
        )

    # Ensure bank exists (idempotent — safe to call every time)
    await ensure_bank(req.customer_id, customer.name)

    memories, _ = await retrieve_memories(req.customer_id, req.message)
    reflection = await reflect(req.customer_id, req.message)

    response_text, suggested_solution = await generate_response(
        customer, memories, req.message, reflection
    )

    await save_memory(
        req.customer_id,
        f'Customer: "{req.message[:120]}". Agent: "{response_text[:120]}".',
        "support session",
    )

    frustration_score = customer.frustration_score
    escalation_flag = frustration_score > 70

    return SupportResponse(
        response=response_text,
        customer_name=customer.name,
        retrieved_memories=memories,
        memory_saved=True,
        frustration_score=frustration_score,
        escalation_flag=escalation_flag,
        suggested_solution=suggested_solution,
    )


@app.post("/chat", response_model=SupportResponse)
async def customer_chat(req: ChatRequest, user: dict = Depends(get_current_user)):
    customer = await get_customer(req.customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{req.customer_id}' not found"
        )

    await ensure_bank(req.customer_id, customer.name)
    memories, _ = await retrieve_memories(req.customer_id, req.message)
    reflection = await reflect(req.customer_id, req.message)
    response_text, suggested_solution = await generate_response(
        customer, memories, req.message, reflection
    )
    await save_memory(
        req.customer_id,
        f'Customer: "{req.message[:120]}". Agent: "{response_text[:120]}".',
        "support session",
    )

    frustration_score = customer.frustration_score
    escalation_flag = frustration_score > 70

    return SupportResponse(
        response=response_text,
        customer_name=customer.name,
        retrieved_memories=memories,
        memory_saved=True,
        frustration_score=frustration_score,
        escalation_flag=escalation_flag,
        suggested_solution=suggested_solution,
    )


@app.patch("/tickets/{ticket_id}/resolve")
async def resolve_ticket_endpoint(ticket_id: str, _: dict = Depends(require_admin)):
    try:
        ticket = await resolve_ticket(ticket_id)
        return ticket
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Customer self-service endpoints ──────────────────────────


async def _get_customer_by_email(email: str):
    """Look up customer row by email — mock-aware."""
    if USE_MOCK:
        customers = await list_customers()
        for c in customers:
            if c.email == email:
                return c
        return None
    client = get_supabase_client()
    rows = client.table("customers").select("*").eq("email", email).limit(1).execute()
    if rows.data and len(rows.data) > 0:
        return rows.data[0]
    return None


async def _get_tickets_by_customer(customer_id: str):
    """Get tickets for a customer — mock-aware."""
    if USE_MOCK:
        return await get_tickets(customer_id)
    client = get_supabase_client()
    rows = (
        client.table("tickets")
        .select("*")
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .execute()
    )
    return rows.data if rows.data else []


async def _create_ticket_for_customer(customer_id: str, subject: str):
    """Create a ticket and increment ticket_count — mock-aware."""
    import uuid

    ticket_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    if USE_MOCK:
        from dev.mock_repository import TICKETS, CUSTOMERS

        ticket = {
            "id": ticket_id,
            "customer_id": customer_id,
            "subject": subject,
            "status": "open",
            "created_at": now,
            "resolved_at": None,
        }
        TICKETS.setdefault(customer_id, []).insert(0, ticket)
        for c in CUSTOMERS:
            if c["id"] == customer_id:
                c["ticket_count"] = c.get("ticket_count", 0) + 1
                break
        return ticket
    client = get_supabase_client()
    ticket = {
        "id": ticket_id,
        "customer_id": customer_id,
        "subject": subject,
        "status": "open",
        "created_at": now,
    }
    client.table("tickets").insert(ticket).execute()
    client.rpc("increment_ticket_count", {"cust_id": customer_id}).execute()
    return ticket


@app.get("/my/profile")
async def my_profile(user: dict = Depends(get_current_user)):
    email = user.get("email", "")
    customer = await _get_customer_by_email(email)
    if customer is None:
        raise HTTPException(
            status_code=404,
            detail="Customer profile not found — contact support",
        )
    return customer


@app.get("/my/tickets")
async def my_tickets(user: dict = Depends(get_current_user)):
    email = user.get("email", "")
    customer = await _get_customer_by_email(email)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer profile not found")
    customer_id = customer["id"] if isinstance(customer, dict) else customer.id
    tickets = await _get_tickets_by_customer(customer_id)
    return tickets


@app.post("/my/tickets")
async def create_my_ticket(
    req: CreateTicketRequest, user: dict = Depends(get_current_user)
):
    email = user.get("email", "")
    customer = await _get_customer_by_email(email)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer profile not found")
    customer_id = customer["id"] if isinstance(customer, dict) else customer.id
    ticket = await _create_ticket_for_customer(customer_id, req.subject)
    return ticket


@app.post("/my/chat")
async def my_chat(req: MyChatRequest, user: dict = Depends(get_current_user)):
    email = user.get("email", "")
    customer = await _get_customer_by_email(email)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer profile not found")
    customer_id = customer["id"] if isinstance(customer, dict) else customer.id
    customer_name = customer["name"] if isinstance(customer, dict) else customer.name

    await ensure_bank(customer_id, customer_name)
    memories, _ = await retrieve_memories(customer_id, req.message)
    reflection = await reflect(customer_id, req.message)

    response_text, suggested_solution = await generate_response(
        {"id": customer_id, "name": customer_name}, memories, req.message, reflection
    )

    await save_memory(
        customer_id,
        f'Customer: "{req.message[:120]}". Agent: "{response_text[:120]}".',
        "support session",
    )

    return MyChatResponse(reply=response_text, suggested_solution=suggested_solution)


# ── WebSocket ────────────────────────────────────────────────


@app.websocket("/ws/session/{customer_id}")
async def websocket_session(
    websocket: WebSocket, customer_id: str, token: str | None = None
):
    # Verify auth for WebSocket (admin-only)
    user = await verify_ws_token(token)
    if user is None and not USE_MOCK:
        await websocket.close(code=4001, reason="Unauthorized")
        return

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

            # 4. Generate LLM response
            response_text, suggested_solution = await generate_response(
                customer, memories, message, reflection
            )

            # 5. Save this interaction to memory (async-friendly — fire and don't wait)
            await save_memory(
                customer_id,
                f'Customer said: "{message[:120]}". '
                f'Agent replied: "{response_text[:120]}".',
                "support session",
            )

            # 6. Compute escalation flag from customer's frustration score
            frustration_score = customer.frustration_score
            escalation_flag = frustration_score > 70

            # 7. Send reply to frontend
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
