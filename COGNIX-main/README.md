# COGNIX — Support that remembers every customer

An AI-powered customer support agent backend built with **FastAPI** that uses **Hindsight** (persistent memory) to give support agents full conversational history and context — so customers never have to repeat themselves.

- **Backend**: FastAPI REST + WebSocket server (Python)
- **Frontend**: Supabase-authenticated support agent dashboard (static HTML/JS/CSS, "MemoryDesk")
- **Memory**: Hindsight Cloud for persistent per-customer memory
- **LLM**: Groq (placeholder — returns stubs)
- **Database**: Supabase (or in-memory mock mode for development)

---

## Architecture

### Mode Switching: Production vs. Mock

The backend runs in one of two modes, controlled by the `USE_MOCK_DATA` environment variable:

| Mode | `USE_MOCK_DATA` | Repositories | Requirements |
|------|----------------|--------------|--------------|
| **Production** | `false` (default) | `repositories/customer_repository.py`, `repositories/ticket_repository.py` | Supabase credentials |
| **Mock/Dev** | `true` | `dev/mock_repository.py` (in-memory dicts with 50 customers, 146 tickets, 308 memories) | None |

The memory layer (`memory.py`) and LLM layer (`llm.py`) are **not** affected by mock mode — they connect to Hindsight and Groq respectively regardless.

---

### Project Structure

```
COGNIX/
├── README.md
├── requirements.txt
├── .env                          (gitignored — credentials)
├── .gitignore
│
├── backend/
│   ├── main.py                   # FastAPI app — routes, CORS, lifespan
│   ├── models.py                 # 7 Pydantic models
│   ├── memory.py                 # Hindsight memory integration
│   ├── llm.py                    # Groq LLM (stub)
│   ├── agent.py                  # Pydantic AI agent (placeholder)
│   ├── repositories/
│   │   ├── customer_repository.py  # Supabase customer CRUD
│   │   └── ticket_repository.py    # Supabase ticket CRUD
│   └── dev/
│       ├── mock_data.py           # Demo dataset (10 companies, 50 customers, ...)
│       └── mock_repository.py     # In-memory mock of all repos
│
├── frontend/
│   ├── login.html / .css / .js    # Supabase auth (email + Google)
│   ├── dashboard.html / .css / .js # Agent dashboard with ticket queue
│   └── agent/
│       ├── customer_profile.html   # Static customer profile mockup
│       └── hi.html                 # (empty)
```

---

## Components

### `backend/main.py` — Application Entrypoint
- **Port**: `8000` (configurable via `PORT`)
- **CORS**: Allows `FRONTEND_URL` (default `http://localhost:3000`)
- **Lifespan**: Validates required env vars at startup
- **Endpoints**:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check with service statuses |
| `GET` | `/customers` | List all customers |
| `POST` | `/customers` | Create a customer + seed Hindsight memory bank |
| `GET` | `/customers/{id}` | Get customer by ID |
| `GET` | `/customers/{id}/memories` | Get memories for a customer |
| `GET` | `/customers/{id}/tickets` | Get tickets for a customer |
| `POST` | `/support/chat` | REST chat — returns response + memories + reflection + escalation |
| `WS` | `/ws/session/{customer_id}` | WebSocket chat session with real-time memory/status events |
| `GET` | `/demo/memory-flow` | Hardcoded end-to-end pipeline demo |

### `backend/models.py` — 7 Pydantic Models

| Model | Key Fields |
|-------|-----------|
| `Customer` | id, name, email, company, plan (free/pro/enterprise), ticket_count, frustration_score |
| `Message` | role (user/assistant/system), content, timestamp |
| `Ticket` | id, customer_id, subject, status (open/resolved/escalated), created_at, resolved_at |
| `MemoryEntry` | id, customer_id, content, context, memory_type (world_fact/experience/observation), created_at |
| `SupportRequest` | customer_id, message |
| `SupportResponse` | response, customer_name, retrieved_memories, memory_saved, frustration_score, escalation_flag, suggested_solution |
| `CreateCustomerRequest` | name, email, company, plan |

### `backend/memory.py` — Hindsight Cloud Integration
- One Hindsight bank per customer (bank_id = customer_id)
- Disposition: empathy=5, skepticism=2, literalism=2
- Functions: `retrieve_memories`, `save_memory`, `get_all_memories`, `reflect`, `ensure_bank`, `seed_customer_memory`

### `backend/llm.py` — LLM Stub
- `generate_response()` — placeholder returning `("", None)`
- Intended for Groq SDK integration

### `backend/agent.py` — Placeholder
- Contains only `#Pydantic ai code here`

### `backend/repositories/` — Plain Async Functions
- **No classes, no DI** — module-level singleton Supabase clients
- `customer_repository.py`: `get_customer`, `list_customers`, `create_customer`, `update_frustration_score`, `increment_ticket_count`
- `ticket_repository.py`: `get_tickets`, `create_ticket`, `resolve_ticket`, `escalate_ticket`, `get_open_ticket_count`

### `backend/dev/mock_data.py` — Demo Dataset
Generated dataset for development and demos:
- **10 companies** across industries (fintech, healthcare, e-commerce, logistics, security, education, martech, CRM, devtools)
- **50 customers** (5 per company), with realistic names, roles, and timezones
- **146 tickets** spanning categories: billing, SSO, API, webhook, audit, integration, deployment
- **308 memories** across types: preference, environment, incident, risk_signal, business_context, successful_resolution, product_usage
- **5 special demo customers** with memory chains for demonstrating the full memory pipeline

### Frontend — MemoryDesk
- **login.html**: Supabase auth with email/password and Google OAuth
- **dashboard.html**: Agent dashboard with ticket queue, trending issues, frustration score rings
- **customer_profile.html**: Static Tailwind CSS mockup of a customer profile screen

---

## Setup

### Prerequisites
- Python 3.11+
- A Hindsight Cloud account (for memory) — optional in mock mode

### Environment Variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_key
HINDSIGHT_API_KEY=your_hindsight_key
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_key
FRONTEND_URL=http://localhost:3000
PORT=8000
HINDSIGHT_BASE_URL=https://api.hindsight.vectorize.io
```

### Running

```bash
# Install dependencies
pip install -r requirements.txt

# Start in mock mode (no credentials needed)
$env:USE_MOCK_DATA="true"
uvicorn backend.main:app --reload --port 8000

# Start in production mode (requires Supabase credentials)
uvicorn backend.main:app --reload --port 8000
```

### WebSocket Chat Demo

Open a WebSocket to `ws://localhost:8000/ws/session/cust_001` and send:

```json
{"message": "I'm having trouble with my billing invoice"}
```

You'll receive real-time events: opening message, status updates, memory retrieval visualization, and chat replies.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework |
| `uvicorn` | ASGI server |
| `pydantic-ai` | Pydantic AI agent framework (intended) |
| `hindsight-client` | Hindsight memory API |
| `python-dotenv` | Load `.env` files |
| `supabase` | Supabase async database client |

---

## Development Notes

- **LLM is a stub**: `generate_response()` always returns empty — swap in the Groq SDK
- **Agent is a placeholder**: `agent.py` needs Pydantic AI agent logic
- **No tests yet**: Test framework not configured
- **Frontend bug**: `login.js` redirects to `fronted/dashboard.html` (typo — should be `frontend/dashboard.html`)
- Hardcoded Supabase anon key in frontend JS files (public by Supabase design, but worth managing via env vars)
