from typing import Optional

from models import Customer, CreateCustomerRequest


async def get_customer(customer_id: str) -> Optional[Customer]:
    return None


async def list_customers() -> list[Customer]:
    return []


async def create_customer(req: CreateCustomerRequest) -> Customer:
    raise NotImplementedError("Supabase not yet connected")
