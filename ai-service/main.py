"""
Optional Python Agentic AI Microservice (FastAPI + Pydantic + Gemini SDK)
-------------------------------------------------------------------------
Demonstrates the standalone Python Agentic AI service architecture described in
Section 9 of the JulleyOnline Forward Deployed Engineer Intern Assignment Guide.

Security Invariant:
- Never accepts untrusted `tenant_id` directly from browsers.
- Accepts requests ONLY from the Node.js backend with a shared internal HMAC/secret
  (`INTERNAL_SERVICE_SECRET`) and verified `tenant_id`, `tenant_name`, and `user_id`.
- Restricts the LLM to four read-only, tenant-scoped tools:
  1. `get_tasks`
  2. `get_overdue_tasks`
  3. `get_activity_logs`
  4. `get_board_summary`
"""

import os
from datetime import date
from typing import Any, Dict, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

app = FastAPI(
    title="TenantFlow Agentic AI Service",
    version="1.0.0",
    description="Read-only tenant-isolated Agentic Kanban Assistant powered by Python & FastAPI",
)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://kanban_user:secure_password@localhost:5432/collaborative_kanban")
INTERNAL_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "node-to-python-verified-context-secret")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")


class VerifiedAgentRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=1000)
    verified_tenant_id: str = Field(..., description="Injected by Node.js RBAC middleware after SQL check")
    verified_tenant_name: str
    verified_user_name: str
    board_id: Optional[str] = None


class AgentResponse(BaseModel):
    answer: str
    tools_used: List[str]
    tenant_id: str


def get_db_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


# ============================================================================
# Allowlisted Read-Only Tenant-Scoped Agent Tools
# ============================================================================

def tool_get_tasks(tenant_id: str, board_id: Optional[str] = None, status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    query = """
        SELECT t.id, t.title, t.priority, t.due_date, t.version,
               c.name AS column_name, u.name AS assignee_name
        FROM tasks t
        JOIN columns c ON c.id = t.column_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.tenant_id = %s
    """
    params: List[Any] = [tenant_id]
    if board_id:
        query += " AND t.board_id = %s"
        params.append(board_id)
    if status_filter:
        query += " AND LOWER(c.name) = LOWER(%s)"
        params.append(status_filter)
    query += " ORDER BY c.position ASC, t.position ASC"

    with get_db_conn() as conn, conn.cursor() as cur:
        cur.execute(query, params)
        return [dict(row) for row in cur.fetchall()]


def tool_get_overdue_tasks(tenant_id: str, board_id: Optional[str] = None) -> List[Dict[str, Any]]:
    query = """
        SELECT t.id, t.title, t.priority, t.due_date,
               c.name AS column_name, u.name AS assignee_name
        FROM tasks t
        JOIN columns c ON c.id = t.column_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.tenant_id = %s
          AND t.due_date IS NOT NULL
          AND t.due_date < %s
          AND LOWER(c.name) != 'done'
    """
    params: List[Any] = [tenant_id, date.today().isoformat()]
    if board_id:
        query += " AND t.board_id = %s"
        params.append(board_id)

    with get_db_conn() as conn, conn.cursor() as cur:
        cur.execute(query, params)
        return [dict(row) for row in cur.fetchall()]


def tool_get_activity_logs(tenant_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    safe_limit = max(1, min(limit, 25))
    query = """
        SELECT a.action, a.entity_type, a.details, a.created_at, u.name AS user_name
        FROM activity_logs a
        JOIN users u ON u.id = a.user_id
        WHERE a.tenant_id = %s
        ORDER BY a.created_at DESC
        LIMIT %s
    """
    with get_db_conn() as conn, conn.cursor() as cur:
        cur.execute(query, [tenant_id, safe_limit])
        return [dict(row) for row in cur.fetchall()]


def tool_get_board_summary(tenant_id: str, board_id: Optional[str] = None) -> Dict[str, Any]:
    tasks = tool_get_tasks(tenant_id, board_id)
    overdue = tool_get_overdue_tasks(tenant_id, board_id)
    total = len(tasks)
    done = sum(1 for t in tasks if str(t.get("column_name", "")).lower() == "done")
    in_progress = sum(1 for t in tasks if str(t.get("column_name", "")).lower() == "in progress")
    todo = sum(1 for t in tasks if str(t.get("column_name", "")).lower() == "to do")
    return {
        "total_tasks": total,
        "completed": done,
        "in_progress": in_progress,
        "to_do": todo,
        "overdue_count": len(overdue),
        "completion_rate_percent": round((done / total) * 100) if total else 0,
    }


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "python-agentic-kanban-assistant"}


@app.post("/agent/query", response_model=AgentResponse)
def query_kanban_agent(
    payload: VerifiedAgentRequest,
    x_internal_secret: str = Header(default=""),
):
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Untrusted caller: requests must originate from Node.js backend.")

    client = genai.Client(api_key=GEMINI_API_KEY)
    tools_used: List[str] = []

    def get_tasks(status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieve authorized tasks in the current tenant workspace."""
        tools_used.append("get_tasks")
        return tool_get_tasks(payload.verified_tenant_id, payload.board_id, status_filter)

    def get_overdue_tasks() -> List[Dict[str, Any]]:
        """Retrieve overdue incomplete tasks in the current tenant workspace."""
        tools_used.append("get_overdue_tasks")
        return tool_get_overdue_tasks(payload.verified_tenant_id, payload.board_id)

    def get_activity_logs(limit: int = 10) -> List[Dict[str, Any]]:
        """Retrieve recent collaboration activity logs in the current tenant workspace."""
        tools_used.append("get_activity_logs")
        return tool_get_activity_logs(payload.verified_tenant_id, limit)

    def get_board_summary() -> Dict[str, Any]:
        """Retrieve task counts and completion percentage for the current tenant board."""
        tools_used.append("get_board_summary")
        return tool_get_board_summary(payload.verified_tenant_id, payload.board_id)

    response = client.models.generate_content(
        model="gemini-3.8-flash",
        contents=payload.question,
        config=types.GenerateContentConfig(
            system_instruction=(
                f"You are a read-only Kanban AI agent for branch '{payload.verified_tenant_name}'. "
                f"Never fabricate task counts; invoke the provided tools and summarize clearly."
            ),
            tools=[get_tasks, get_overdue_tasks, get_activity_logs, get_board_summary],
        ),
    )

    return AgentResponse(
        answer=response.text or "Summary generated.",
        tools_used=list(dict.fromkeys(tools_used)),
        tenant_id=payload.verified_tenant_id,
    )
