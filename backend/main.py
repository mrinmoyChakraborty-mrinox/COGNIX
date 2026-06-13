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
from memory import MemoryService

load_dotenv()

logger = logging.getLogger("cognix")

USE_MOCK = os.getenv("USE_MOCK_DATA", "").lower() in ("true", "1", "yes")

if USE_MOCK:
    from dev.mock_repository import MockCustomerRepository as CustomerRepository
    from dev.mock_repository import MockTicketRepository as TicketRepository

    logger.info("Using mock repositories (USE_MOCK_DATA=true)")
else:
    from repositories.customer_repository import CustomerRepository
    from repositories.ticket_repository import TicketRepository

customer_repo = CustomerRepository()
ticket_repo = TicketRepository()
memory_service = MemoryService()


class CustomerService:
    def __init__(self) -> None:
        self.repo = customer_repo
        self.ticket_repo = ticket_repo

    async def get_customer(self, customer_id: str) -> Customer | None:
        return await self.repo.get_customer(customer_id)

    async def list_customers(self) -> list[Customer]:
        return await self.repo.list_customers()

    async def create_customer(self, req: CreateCustomerRequest) -> Customer:
        return await self.repo.create_customer(req)

    async def compute_frustration_score(self, customer_id: str) -> int:
        # TODO: compute from open/escalated ticket ratio when Supabase is connected
        return 0


class TicketService:
    def __init__(self) -> None:
        self.repo = ticket_repo

    async def get_tickets(self, customer_id: str) -> list[Ticket]:
        return await self.repo.get_tickets(customer_id)


class LLMService:
    """Generates responses using Groq SDK (not yet connected)."""

    async def generate_response(
        self,
        customer: Customer,
        memories: list[MemoryEntry],
        message: str,
        reflect_summary: str,
    ) -> tuple[str, str | None]:
        # TODO: Replace with Groq SDK:
        #   from groq import Groq
        #   client = Groq(api_key=GROQ_API_KEY)
        #   completion = client.chat.completions.create(...)
        #   return completion.choices[0].message.content, suggested_solution
        return "", None


customer_service = CustomerService()
ticket_service = TicketService()
llm_service = LLMService()


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
async def list_customers():
    return await customer_service.list_customers()


@app.post("/customers", response_model=Customer, status_code=status.HTTP_201_CREATED)
async def create_customer(req: CreateCustomerRequest):
    return await customer_service.create_customer(req)


@app.get("/customers/{customer_id}", response_model=Customer)
async def get_customer(customer_id: str):
    customer = await customer_service.get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return customer


@app.get("/customers/{customer_id}/memories", response_model=list[MemoryEntry])
async def get_customer_memories(customer_id: str):
    customer = await customer_service.get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return await memory_service.get_all_memories(customer_id)


@app.get("/customers/{customer_id}/tickets", response_model=list[Ticket])
async def get_customer_tickets(customer_id: str):
    customer = await customer_service.get_customer(customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{customer_id}' not found"
        )
    return await ticket_service.get_tickets(customer_id)


@app.post("/support/chat", response_model=SupportResponse)
async def support_chat(req: SupportRequest):
    customer = await customer_service.get_customer(req.customer_id)
    if customer is None:
        raise HTTPException(
            status_code=404, detail=f"Customer '{req.customer_id}' not found"
        )

    memories = await memory_service.retrieve_memories(req.customer_id, req.message)
    reflect_summary = await memory_service.reflect(req.customer_id, req.message)
    response_text, suggested_solution = await llm_service.generate_response(
        customer, memories, req.message, reflect_summary
    )
    await memory_service.save_memory(
        req.customer_id,
        f'Customer asked: "{req.message[:100]}". Agent responded: "{response_text[:100]}".',
        "support session",
    )
    frustration_score = await customer_service.compute_frustration_score(
        req.customer_id
    )
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

    customer = await customer_service.get_customer(customer_id)
    if customer is None:
        await websocket.close(code=4004, reason=f"Customer '{customer_id}' not found")
        return

    opening_query = "What is this customer most likely contacting support about today?"
    reflect_summary = await memory_service.reflect(customer_id, opening_query)
    await websocket.send_json({"event": "opening", "data": reflect_summary})

    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"event": "status", "data": "thinking..."})

            memories = await memory_service.retrieve_memories(customer_id, data)
            reflect_summary = await memory_service.reflect(customer_id, data)
            response_text, _ = await llm_service.generate_response(
                customer, memories, data, reflect_summary
            )
            await memory_service.save_memory(
                customer_id,
                f'Customer: "{data[:100]}". Agent: "{response_text[:100]}".',
                "support session",
            )
            frustration_score = await customer_service.compute_frustration_score(
                customer_id
            )

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
