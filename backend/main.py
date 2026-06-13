import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
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

load_dotenv()

logger = logging.getLogger("cognix")

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

from memory import retrieve_memories, save_memory, get_all_memories, reflect
from llm import generate_response


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("COGNIX starting up")
    yield
    logger.info("COGNIX shutting down")


app = FastAPI(
    title="COGNIX",
    version="1.0.0",
    description="Customer support agent with persistent memory",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {
            "hindsight": "not_connected",
            "groq": "not_connected",
            "supabase": "not_connected",
        },
    }


@app.get("/customers", response_model=list[Customer])
async def list_all_customers():
    return await list_customers()


@app.post("/customers", response_model=Customer, status_code=status.HTTP_201_CREATED)
async def create_new_customer(req: CreateCustomerRequest):
    return await create_customer(req)


@app.get("/customers/{customer_id}", response_model=Customer)
async def get_customer_by_id(customer_id: str):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return customer


@app.get("/customers/{customer_id}/memories", response_model=list[MemoryEntry])
async def get_customer_memories(customer_id: str):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return await get_all_memories(customer_id)


@app.get("/customers/{customer_id}/tickets", response_model=list[Ticket])
async def get_customer_tickets(customer_id: str):
    customer = await get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return await get_tickets(customer_id)


@app.post("/support/chat", response_model=SupportResponse)
async def support_chat(req: SupportRequest):
    customer = await get_customer(req.customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{req.customer_id}' not found"
        )

    memories = await retrieve_memories(req.customer_id, req.message)
    reflection = await reflect(req.customer_id, req.message)
    response_text, suggested_solution = await generate_response(
        customer, memories, req.message, reflection
    )
    await save_memory(
        req.customer_id,
        f'Customer asked: "{req.message[:100]}". Agent responded: "{response_text[:100]}".',
        "support session",
    )

    frustration_score = 0
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


@app.websocket("/ws/session/{customer_id}")
async def websocket_session(websocket: WebSocket, customer_id: str):
    await websocket.accept()
    logger.info("WebSocket connected | customer_id=%s", customer_id)

    customer = await get_customer(customer_id)
    if customer is None:
        await websocket.close(code=4004, reason=f"Customer '{customer_id}' not found")
        return

    opening_reflection = await reflect(
        customer_id, "What is this customer most likely contacting support about today?"
    )
    await websocket.send_json({"event": "opening", "data": opening_reflection})

    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"event": "status", "data": "thinking..."})

            memories = await retrieve_memories(customer_id, data)
            reflection = await reflect(customer_id, data)
            response_text, _ = await generate_response(
                customer, memories, data, reflection
            )
            await save_memory(
                customer_id,
                f'Customer: "{data[:100]}". Agent: "{response_text[:100]}".',
                "support session",
            )

            frustration_score = 0
            await websocket.send_json(
                {"event": "memory.update", "data": [m.content for m in memories]}
            )
            await websocket.send_json(
                {
                    "event": "chat.reply",
                    "data": response_text,
                    "escalation_flag": frustration_score > 70,
                    "frustration_score": frustration_score,
                }
            )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected | customer_id=%s", customer_id)
    except Exception as e:
        logger.error(
            "WebSocket error | customer_id=%s | error=%s",
            customer_id,
            str(e),
            exc_info=True,
        )
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
