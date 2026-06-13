"""Gateway for mock/test data.

Populate these dictionaries with Customer, Ticket, and MemoryEntry instances
during local development or testing. Production code never imports this module.

Usage:
    from dev.mock_data import MOCK_CUSTOMERS, MOCK_TICKETS, MOCK_MEMORIES
"""

from datetime import datetime, timezone, timedelta
from models import Customer, Ticket, MemoryEntry


NOW = datetime.now(timezone.utc)

MOCK_CUSTOMERS: dict[str, Customer] = {}
MOCK_TICKETS: dict[str, list[Ticket]] = {}
MOCK_MEMORIES: dict[str, list[MemoryEntry]] = {}
