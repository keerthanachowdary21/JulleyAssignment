# TenantFlow — Real-Time Multi-Tenant Collaborative Kanban Board

> **Forward Deployed Engineer Intern — Complete Assignment Implementation & Submission Package**

## 1. Project Overview

**TenantFlow** is a production-grade, multi-organization, multi-tenant collaborative Kanban application engineered for distributed enterprises. Multiple parent companies (**Organizations**) operate independent regional branches (**Tenants**), where employees collaborate on project **Boards**, workflow **Columns**, and **Tasks** in real time without cross-branch data leakage.

## 2. Business Problem Solved

Consider **ABC Technologies** operating branches in **Hyderabad**, **Bangalore**, and **Chennai**, alongside a separate customer **XYZ Solutions** operating in **Mumbai** and **Pune**:
- When **Rahul** or **Priya** moves a task from *To Do* to *In Progress* in Hyderabad, **Arjun** (viewing Hyderabad in another browser) sees the card move instantaneously via Socket.IO.
- **Sneha** (Bangalore Tenant Admin) and **Kiran** (XYZ Solutions) never receive Hyderabad WebSocket broadcasts and are blocked with `403 Forbidden` if they attempt to query or mutate Hyderabad boards or tasks by UUID.
- If **Rahul** and **Priya** simultaneously edit or drag the same task based on `version: 1`, optimistic concurrency locking commits the first transaction (`version: 2`) and returns **`409 Conflict`** with the authoritative server record to the second writer, preventing silent data loss.

## 3. Core Features Implemented

1. **JWT Authentication & Bcrypt Security**: Full user registration, login, password hashing (`bcryptjs`, cost 10), and one-click persona switching for rapid evaluation.
2. **Multi-Organization & Branch Hierarchy**: Dynamic Organization Selector and Branch/Tenant Switcher backed strictly by SQL membership queries—zero stale data across context switches.
3. **Three-Tier RBAC Enforcement**: Backend-enforced permissions for `ORG_ADMIN`, `TENANT_ADMIN`, and `MEMBER` across every REST endpoint and WebSocket action.
4. **Interactive Drag-and-Drop Kanban (`@dnd-kit`)**: Optimistic task reordering within columns and across columns backed by ACID SQL transactions and rollback reconciliation.
5. **Real-Time Socket.IO Collaboration**: JWT-authenticated handshakes, server-authorized `tenant:<id>` rooms, live task/column/board synchronization, and live audit streaming.
6. **Multi-Tab Presence Indicators**: Tracks `Set<socketId>` per user per tenant so multiple open tabs don't cause false offline drops.
7. **Optimistic Concurrency & Conflict Resolution (`HTTP 409`)**: Version-checked updates and moves with an interactive UI Conflict Resolver (*Load Latest Server Version* vs *Force Overwrite*).
8. **Network Recovery & State Reconciliation**: Automatic Socket.IO reconnection, room re-authorization, and authoritative board refetch upon recovery.
9. **Agentic AI Kanban Assistant**: Server-side `gemini-3.8-flash` function-calling agent restricted to four allowlisted read-only tools (`get_tasks`, `get_overdue_tasks`, `get_activity_logs`, `get_board_summary`) bound to verified tenant context—plus standalone Python FastAPI reference service (`ai-service/main.py`).
10. **Built-In Security & Concurrency Lab + Interactive Docs Portal**: Test live cross-tenant attacks (`403`), RBAC blocks (`403`), stale-version conflicts (`409`), and inspect the ER Diagram, SQL/Prisma schemas, and API/WebSocket specs directly inside the web app.

## 4. Technology Stack

| Layer | Technology | Role in Architecture |
| --- | --- | --- |
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, `@dnd-kit` | Responsive Kanban UI, optimistic drag-and-drop, conflict modal, live docs portal |
| **Backend** | Node.js, Express.js, Zod | REST CRUD APIs, JWT auth, RBAC & tenant isolation middleware, ACID transactions |
| **Real-Time** | Socket.IO (`socket.io` + `socket.io-client`) | Persistent bidirectional WebSocket rooms (`tenant:<id>`) & multi-tab presence |
| **Database** | Relational SQL (`better-sqlite3` runtime + PostgreSQL 16 DDL & Prisma ORM) | 8 normalized tables, foreign keys, composite tenant indexes, optimistic locking |
| **Agentic AI** | `@google/genai` (`gemini-3.8-flash`) + Python FastAPI (`ai-service/`) | Tool-calling workspace insights strictly scoped to verified tenant IDs |

## 5. System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        React 19 Frontend SPA                            │
│  Org Selector • Branch Switcher • @dnd-kit Kanban • Conflict Resolver   │
└───────────────┬─────────────────────────────────────────┬───────────────┘
                │ REST HTTPS (Bearer JWT)                 │ WebSocket (Auth JWT)
                ▼                                         ▼
┌───────────────────────────────────────┐ ┌───────────────────────────────┐
│      Express.js API Controllers       │ │     Socket.IO Room Server     │
│  Zod Validation • RBAC • Transactions │ │  SQL Room Auth • Presence Map │
└───────────────┬───────────────────────┘ └───────────────┬───────────────┘
                │                                         │
                └────────────────────┬────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│        Relational SQL Engine (8 Tables + Tenant-Scoped Indexes)         │
│  organizations • tenants • users • memberships • boards • columns •     │
│  tasks (with version counter) • activity_logs                           │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Verified Tenant Context Only
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│     Agentic AI Kanban Service (Gemini 3.8 Flash / Python FastAPI)       │
│  Tools: get_tasks • get_overdue_tasks • get_activity_logs • summary     │
└─────────────────────────────────────────────────────────────────────────┘
```

## 6. Multi-Tenant Isolation Model

1. **Separate Entities**: `organizations` represent parent companies (`ABC Technologies`, `XYZ Solutions`), while `tenants` represent isolated regional branches (`Hyderabad`, `Bangalore`, `Chennai`, `Mumbai`, `Pune`).
2. **Mandatory `tenant_id` Ownership**: Every business table (`boards`, `columns`, `tasks`, `activity_logs`) carries a non-null `tenant_id` foreign key.
3. **Server-Derived Authorization (`resolveTenantAccess`)**: The backend never trusts a `tenantId` solely because the browser sent it. Every request resolves the caller's JWT `sub` (`userId`) against `memberships` in SQL (`tenant_id = ? OR (organization_id = ? AND tenant_id IS NULL AND role = 'ORG_ADMIN')`).
4. **Cross-Entity Verification**: Creating or moving a task verifies that the target `board_id`, `column_id`, and `assigned_to` user all belong to the exact same authorized `tenant_id`.
5. **WebSocket Room Isolation**: Calling `socket.emit('tenant:join', { tenantId })` runs `resolveTenantAccess` on the server before `socket.join('tenant:' + tenantId)`. Switching branches immediately removes the socket from previous `tenant:*` rooms.

## 7. Role-Based Access Control (RBAC)

| Capability | `ORG_ADMIN` | `TENANT_ADMIN` | `MEMBER` |
| --- | :---: | :---: | :---: |
| View & switch across all branches in Organization | Yes | Only assigned branch(es) | Only assigned branch(es) |
| Create / rename / delete Branch Tenants | Yes | No (`403`) | No (`403`) |
| Grant `ORG_ADMIN` role | Yes | No (`403`) | No (`403`) |
| Manage Branch Members (`TENANT_ADMIN` / `MEMBER`) | Yes | Yes | No (`403`) |
| Create / edit / delete Boards & Workflow Columns | Yes | Yes | No (`403`) |
| Create, edit, assign, drag-and-drop & delete Tasks | Yes | Yes | Yes |
| View live Presence, Activity Audit & AI Assistant | Yes | Yes | Yes |

## 8. Concurrency & Conflict Resolution Strategy

- **Optimistic Locking (`version` integer)**: Every `tasks` record starts at `version = 1`.
- **Atomic SQL Transaction**: `PUT /api/tasks/:id` and `PATCH /api/tasks/:id/move` execute inside `db.transaction(...)`, checking `WHERE id = ? AND tenant_id = ? AND version = ?`.
- **Conflict Detection (`HTTP 409`)**: If two teammates open Task A at `v1` and Rahul saves first (`v2`), Priya's stale `expectedVersion: 1` update receives `HTTP 409 Conflict` with `{ code: "VERSION_CONFLICT", serverTask }`.
- **Frontend Resolution**: Priya is presented with a side-by-side comparison showing Rahul's committed `v2` values alongside her draft, allowing her to either **Load Server Version** or **Force Save Over `v2`**.
- **Authoritative Ordering**: Moving tasks re-indexes sibling `position` integers sequentially (`1..N`) inside the same transaction and broadcasts `boardTasks` so concurrent reorders never leave duplicate or gapped positions.

## 9. Architectural Trade-Offs

| Decision | Rationale | Trade-Off & Future Scaling Path |
| --- | --- | --- |
| **Shared-Schema `tenant_id` + RLS** | Instant branch provisioning, unified migrations, strong ACID foreign keys | Requires disciplined `tenant_id` predicates (mitigated via PostgreSQL RLS policies in `database/schema.sql`) |
| **Optimistic Locking (`version`) vs CRDTs** | Deterministic, transparent, zero silent corruption on structured task fields | Conflicting simultaneous edits prompt user confirmation; field-level diff merging can be layered later |
| **Sequential Integer `position` in Transaction** | Exact 1..N ordering with simple SQL queries for boards with <500 cards/column | Re-indexes sibling rows in column on move; large boards (>10k cards) can switch to LexoRank fractional strings |
| **Socket.IO Rooms (`tenant:<id>`)** | Built-in auto-reconnection, acknowledgements, and clean room broadcasting | Multi-node horizontal scaling requires attaching `@socket.io/redis-adapter` |

## 10. Demo Credentials (Seeded Automatically)

Password for all seeded accounts: **`Password@123`**

| Name | Email | Organization | Authorized Branch(es) | Role |
| --- | --- | --- | --- | --- |
| **Rahul Sharma** | `rahul@abctech.in` | ABC Technologies | Hyderabad, Bangalore, Chennai | `ORG_ADMIN` |
| **Priya Nair** | `priya@abctech.in` | ABC Technologies | Hyderabad | `TENANT_ADMIN` |
| **Arjun Reddy** | `arjun@abctech.in` | ABC Technologies | Hyderabad | `MEMBER` |
| **Sneha Rao** | `sneha@abctech.in` | ABC Technologies | Bangalore | `TENANT_ADMIN` |
| **Vikram Iyer** | `vikram@abctech.in` | ABC Technologies | Chennai | `TENANT_ADMIN` |
| **Kiran Deshmukh** | `kiran@xyzsolutions.in` | XYZ Solutions | Mumbai, Pune | `ORG_ADMIN` |

## 11. Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env

# 3. Start full-stack Express + Socket.IO + Vite server (Port 3000)
npm run dev

# 4. Optional standalone Python FastAPI AI service
cd ai-service && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## 12. Repository Deliverables Map

- `server.ts`, `server/db.ts`, `server/auth.ts`, `server/routes.ts`, `server/socket.ts`, `server/ai.ts` — Complete Express + Socket.IO + RBAC + Optimistic Concurrency + Gemini Agentic backend.
- `src/` — Complete React 19 + `@dnd-kit` + Socket.IO frontend workspace & interactive documentation hub.
- `database/schema.sql` — PostgreSQL 16 DDL with 8 tables, indexes, and Row-Level Security (RLS).
- `database/prisma/schema.prisma` — Prisma ORM schema.
- `ai-service/main.py` — Standalone Python FastAPI Agentic AI microservice.
- `docs/database-erd.md`, `docs/api-documentation.md`, `docs/websocket-documentation.md` — Formal architecture, ERD, REST API, and WebSocket specifications.
