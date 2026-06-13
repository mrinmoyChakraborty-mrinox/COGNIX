import logging

from models import MemoryEntry


logger = logging.getLogger("cognix.memory")


async def retrieve_memories(customer_id: str, query: str) -> list[MemoryEntry]:
    # TODO: Replace with Hindsight SDK recall:
    #   result = hindsight.recall(bank_id=customer_id, query=query, budget="mid")
    logger.info("retrieve_memories | customer_id=%s", customer_id)
    return []


async def save_memory(customer_id: str, content: str, context: str) -> bool:
    # TODO: Replace with Hindsight SDK retain:
    #   hindsight.retain(bank_id=customer_id, content=content, context=context)
    logger.info("save_memory | customer_id=%s | context=%s", customer_id, context)
    return True


async def get_all_memories(customer_id: str) -> list[MemoryEntry]:
    logger.info("get_all_memories | customer_id=%s", customer_id)
    return []


async def reflect(customer_id: str, query: str) -> str:
    # TODO: Replace with Hindsight SDK reflect:
    #   response = hindsight.reflect(bank_id=customer_id, query=query, budget="high")
    logger.info("reflect | customer_id=%s", customer_id)
    return ""
