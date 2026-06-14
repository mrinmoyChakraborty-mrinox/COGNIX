from models import Customer, MemoryEntry
from agent import generate_support_response


async def generate_response(
    customer: Customer,
    memories: list[MemoryEntry],
    message: str,
    reflection: str,
) -> tuple[str, str | None]:
    """
    Delegates response generation to the centralized PydanticAI orchestration in agent.py.
    """
    res = await generate_support_response(
        customer, memories, message, reflection
    )
    return res["response"], res["suggested_solution"]
