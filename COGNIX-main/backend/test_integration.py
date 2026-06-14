import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

# Configure env vars for testing
os.environ["USE_MOCK_DATA"] = "true"
os.environ["GROQ_API_KEY"] = "mock_groq_api_key"
os.environ["HINDSIGHT_API_KEY"] = "mock_hindsight_api_key"

# Add backend to path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

import memory
# Globally mock Hindsight memory operations using AsyncMock to handle await correctly
memory.ensure_bank = AsyncMock(return_value=None)
memory.save_memory = AsyncMock(return_value=True)
memory.retrieve_memories = AsyncMock(return_value=([], 10))
memory.reflect = AsyncMock(return_value="Mock reflection")

import auth
import agent
import main
from models import Customer, MemoryEntry, CreateCustomerRequest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from fastapi.security import HTTPAuthorizationCredentials


class TestCognixAuthentication(unittest.IsolatedAsyncioTestCase):
    """
    Test authentication logic including Mock Mode and standard token checks.
    """

    async def test_auth_mock_mode(self):
        # When USE_MOCK is True
        with patch("auth.USE_MOCK", True):
            res = await auth.get_current_user(None)
            self.assertEqual(res, "mock_user")

    async def test_auth_missing_token(self):
        # When USE_MOCK is False
        with patch("auth.USE_MOCK", False):
            with self.assertRaises(HTTPException) as ctx:
                await auth.get_current_user(None)
            self.assertEqual(ctx.exception.status_code, 401)
            self.assertEqual(ctx.exception.detail, "Missing authorization header")

    async def test_auth_invalid_token(self):
        with patch("auth.USE_MOCK", False):
            # Mock get_client to raise on token fetch
            mock_client = MagicMock()
            mock_client.auth.get_user.side_effect = Exception("Invalid token")
            with patch("auth._get_client", return_value=mock_client):
                creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad_token")
                with self.assertRaises(HTTPException) as ctx:
                    await auth.get_current_user(creds)
                self.assertEqual(ctx.exception.status_code, 401)
                self.assertEqual(ctx.exception.detail, "Invalid or expired token")

    async def test_auth_valid_token(self):
        with patch("auth.USE_MOCK", False):
            # Mock get_client to return a valid user response
            mock_user_response = MagicMock()
            mock_user_response.user.id = "user_abc123"
            
            mock_client = MagicMock()
            mock_client.auth.get_user.return_value = mock_user_response
            
            with patch("auth._get_client", return_value=mock_client):
                creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="good_token")
                user_id = await auth.get_current_user(creds)
                self.assertEqual(user_id, "user_abc123")


class TestCognixAgentPipeline(unittest.IsolatedAsyncioTestCase):
    """
    Test the AI Agent functions and pipelines (response, frustration, escalation, summaries, solutions).
    """

    def setUp(self):
        self.customer = Customer(
            id="cust_test_100",
            name="Bob Tester",
            email="bob@example.com",
            created_at=datetime.now(timezone.utc),
            ticket_count=1,
            frustration_score=30
        )
        self.memories = [
            MemoryEntry(
                id="mem_100",
                customer_id="cust_test_100",
                content="Bob reported latency in June.",
                context="support session",
                memory_type="experience",
                created_at=datetime.now(timezone.utc)
            )
        ]
        self.message = "I'm still having billing issues! Refund my card."
        self.reflection = "Customer had latency in June and now has billing issues."

    def test_build_customer_context(self):
        ctx = agent.build_customer_context(self.customer, self.memories, self.message, self.reflection)
        self.assertIn("Bob Tester", ctx)
        self.assertIn("billing issues", ctx)
        self.assertIn("latency in June", ctx)

    async def test_analyze_frustration(self):
        res = await agent.analyze_frustration(self.message)
        self.assertEqual(res["score"], 85)
        self.assertEqual(res["label"], "Highly Frustrated")

    async def test_detect_escalation(self):
        res = await agent.detect_escalation(self.message, 85)
        self.assertTrue(res["escalate"])
        self.assertIn("refund disputes", res["reason"])

    async def test_suggest_solution(self):
        res = await agent.suggest_solution(self.message)
        self.assertEqual(res["root_cause"], "Payment processor communication failure or expired billing info.")
        self.assertIn("Verify credit card", res["recommended_action"])

    async def test_generate_memory_summary(self):
        res = await agent.generate_memory_summary(self.message, "Refunding payment.")
        self.assertIn("Refunding payment", res)

    async def test_generate_support_response(self):
        res = await agent.generate_support_response(
            self.customer, self.memories, self.message, self.reflection
        )
        self.assertIn("response", res)
        self.assertIn("memory_summary", res)
        self.assertEqual(res["frustration_score"], 85)
        self.assertTrue(res["escalation_flag"])
        self.assertIn("refund disputes", res["escalation_reason"])


class TestCognixAPI(unittest.TestCase):
    """
    Test REST endpoint behaviors using FastAPI TestClient in mock repository mode.
    """

    def setUp(self):
        self.client = TestClient(main.app)

    def test_health_check(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "healthy")

    def test_list_customers(self):
        # Valid auth header gets accepted in mock mode
        headers = {"Authorization": "Bearer mock_token"}
        resp = self.client.get("/customers", headers=headers)
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

    def test_create_customer(self):
        headers = {"Authorization": "Bearer mock_token"}
        payload = {
            "name": "Jane Tester",
            "email": "jane@example.com"
        }
        resp = self.client.post("/customers", json=payload, headers=headers)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["name"], "Jane Tester")
        self.assertEqual(resp.json()["email"], "jane@example.com")

    def test_support_chat(self):
        headers = {"Authorization": "Bearer mock_token"}
        # First, ensure customer exists in mock database
        create_payload = {
            "name": "Chat Customer",
            "email": "chat.customer@example.com"
        }
        create_resp = self.client.post("/customers", json=create_payload, headers=headers)
        cust_id = create_resp.json()["id"]

        chat_payload = {
            "customer_id": cust_id,
            "message": "My connection times out constantly!"
        }
        
        resp = self.client.post("/support/chat", json=chat_payload, headers=headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("response", data)
        self.assertEqual(data["customer_name"], "Chat Customer")
        self.assertEqual(data["frustration_score"], 50)  # "times out constantly!" -> timeout/slow fallback -> 50


if __name__ == "__main__":
    unittest.main()
