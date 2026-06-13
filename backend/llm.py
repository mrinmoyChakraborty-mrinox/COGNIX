from models import Customer, MemoryEntry


async def generate_response(
    customer: Customer,
    memories: list[MemoryEntry],
    message: str,
    reflection: str,
) -> tuple[str, str | None]:
    # TODO: Replace with Groq SDK:
    #   from groq import Groq
    #   client = Groq(api_key=GROQ_API_KEY)
    #   completion = client.chat.completions.create(...)
    return "", None
