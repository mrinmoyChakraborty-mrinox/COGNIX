from typing import Optional

from models import Customer, CreateCustomerRequest


class CustomerRepository:
    """Placeholder customer data access layer. Returns empty results until Supabase is connected."""

    async def get_customer(self, customer_id: str) -> Optional[Customer]:
        return None

    async def list_customers(self) -> list[Customer]:
        return []

    async def create_customer(self, req: CreateCustomerRequest) -> Customer:
        raise NotImplementedError("Supabase not yet connected")
