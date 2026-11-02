# REST API Documentation

All protected endpoints require a stateless JWT Bearer token in the `Authorization` header:

```http
Authorization: Bearer <jwt_access_token>
Content-Type: application/json
```

Every tenant-owned resource validates membership against the `memberships` table in SQL before reading or mutating records. Supplying an unauthorized `tenantId` or cross-tenant resource UUID returns **`403 Forbidden`**.

---

## 1. Authentication APIs

### `POST /api/auth/register`
Registers a new user (hashes password with `bcrypt`, cost factor 10) and optionally provisions an initial Organization & Branch.
- **Auth Required**: None
- **Request Body**:
  ```json
  {
    "name": "Ananya Verma",
    "email": "ananya@abctech.in",
    "password": "Password@123",
    "organizationName": "Optional New Org",
    "branchName": "Optional Branch"
  }
  ```
- **Responses**: `201 Created` (`{ token, user, organizations, memberships }`), `400 Bad Request`, `409 Conflict` (duplicate email).

### `POST /api/auth/login`
Authenticates user credentials and issues a 24-hour signed JWT token along with authorized organizations and tenants.
- **Auth Required**: None
- **Request Body**: `{ "email": "rahul@abctech.in", "password": "Password@123" }`
- **Responses**: `200 OK`, `401 Unauthorized`.

### `GET /api/auth/me`
Returns the authenticated user profile and fresh authorized `organizations` and `tenants` hierarchy.
- **Auth Required**: JWT (`MEMBER`+)
- **Responses**: `200 OK`, `401 Unauthorized`.

---

## 2. Organization & Tenant (Branch) APIs

| Method | Endpoint | Min Role | Tenant Scoping & Behavior |
| --- | --- | --- | --- |
| `GET` | `/api/organizations` | Authenticated | Returns only organizations where the user holds membership |
| `POST` | `/api/organizations` | Authenticated | Creates organization, initial branch, default board, and grants caller `ORG_ADMIN` |
| `PUT` | `/api/organizations/:id` | `ORG_ADMIN` | Updates organization name; rejects non-admins with `403` |
| `DELETE` | `/api/organizations/:id` | `ORG_ADMIN` | Cascades deletion of organization resources |
| `GET` | `/api/tenants?organizationId=:id` | Member of Org | Lists only branches within the organization the caller is permitted to view |
| `POST` | `/api/tenants` | `ORG_ADMIN` | Creates a new branch tenant under `organizationId` with a default Kanban board |
| `PUT` | `/api/tenants/:id` | `ORG_ADMIN` | Renames branch tenant |
| `DELETE` | `/api/tenants/:id` | `ORG_ADMIN` | Deletes branch tenant and cascades child boards/tasks |

---

## 3. Team & RBAC Membership APIs

| Method | Endpoint | Min Role | Behavior |
| --- | --- | --- | --- |
| `GET` | `/api/memberships?tenantId=:id` | `MEMBER` | Lists authorized members and their roles inside `tenantId` |
| `POST` | `/api/memberships` | `TENANT_ADMIN` | Assigns or updates user role (`MEMBER`, `TENANT_ADMIN`, or `ORG_ADMIN` if caller is `ORG_ADMIN`) |
| `DELETE` | `/api/memberships/:userId?tenantId=:id` | `TENANT_ADMIN` | Revokes branch membership for user |

---

## 4. Board & Column CRUD APIs

| Method | Endpoint | Min Role | Tenant Scoping & Behavior |
| --- | --- | --- | --- |
| `GET` | `/api/boards?tenantId=:id` | `MEMBER` | Lists boards strictly matching `tenant_id = :id`; returns `403` if caller is not in tenant |
| `GET` | `/api/boards/:id` | `MEMBER` | Returns board, ordered columns, hydrated tasks, and live `onlineUsers` presence |
| `POST` | `/api/boards` | `TENANT_ADMIN` | Creates board with 4 default columns (`To Do`, `In Progress`, `Testing`, `Done`) & broadcasts `board:created` |
| `PUT` | `/api/boards/:id` | `TENANT_ADMIN` | Updates board title/description & broadcasts `board:updated` |
| `DELETE` | `/api/boards/:id` | `TENANT_ADMIN` | Deletes board & broadcasts `board:deleted` |
| `POST` | `/api/columns` | `TENANT_ADMIN` | Appends a new status column at `MAX(position) + 1` & broadcasts `column:created` |
| `PUT` | `/api/columns/:id` | `TENANT_ADMIN` | Renames column & broadcasts `column:updated` |
| `DELETE` | `/api/columns/:id` | `TENANT_ADMIN` | Deletes column & broadcasts `column:deleted` |

---

## 5. Task CRUD, Ordering & Optimistic Concurrency APIs

### `POST /api/tasks`
Creates a task inside an authorized board/column at `version = 1`.
- **Required Role**: `MEMBER`, `TENANT_ADMIN`, or `ORG_ADMIN` in the board's tenant.
- **Validation**: Verifies `columnId` belongs to `boardId` and `assignedTo` (if set) belongs to the same tenant.
- **Broadcasts**: `task:created` and `activity:created` to `tenant:<tenantId>`.

### `GET /api/tasks/:id`
Retrieves task details and task-specific activity history.
- **Cross-Tenant Protection**: If `:id` belongs to Bangalore (`TEN002`) and caller is only authorized in Hyderabad (`TEN001`), returns **`403 Forbidden`** (`code: "TENANT_ISOLATION_BLOCKED"`).

### `PUT /api/tasks/:id` — Optimistic Concurrency Update
Updates task fields inside an ACID SQL transaction while verifying `expectedVersion`.
- **Request Body**:
  ```json
  {
    "title": "Implement Optimistic Concurrency Version Check",
    "description": "Verify expected task version inside ACID SQL transaction.",
    "assignedTo": "USR002",
    "priority": "URGENT",
    "dueDate": "2026-11-08",
    "labels": ["Database", "Concurrency"],
    "columnId": "BRD_HYD_1_COL2",
    "expectedVersion": 1
  }
  ```
- **Success (`200 OK`)**: Increments `version` to `2`, logs activity, broadcasts `task:updated`.
- **Stale Edit Conflict (`409 Conflict`)**:
  ```json
  {
    "error": "Version conflict: You edited v1, but server is already at v2.",
    "code": "VERSION_CONFLICT",
    "serverTask": { "id": "TSK_HYD_04", "version": 2, "...": "..." }
  }
  ```

### `PATCH /api/tasks/:id/move` — Transactional Drag-and-Drop Move
Moves a task within the same column or across columns, re-indexing sibling `position` values atomically.
- **Request Body**:
  ```json
  {
    "destinationColumnId": "BRD_HYD_1_COL3",
    "newPosition": 1,
    "expectedVersion": 2
  }
  ```
- **Responses**: `200 OK` (`{ task, boardTasks }`), `403 Forbidden` (cross-tenant), `409 Conflict` (`VERSION_CONFLICT` with authoritative `serverTask`).

### `DELETE /api/tasks/:id`
Deletes a task within the caller's authorized tenant and broadcasts `task:deleted`.

---

## 6. Activity Audit & Agentic AI Endpoints

- **`GET /api/activity-logs?tenantId=:id`** (`MEMBER`+): Returns latest 60 tenant-isolated audit records (`Created`, `Updated`, `Moved`, `Deleted`).
- **`POST /api/ai/assistant`** (`MEMBER`+): Executes the read-only Agentic AI Kanban Assistant (`gemini-3.8-flash` with allowlisted tools `get_tasks`, `get_overdue_tasks`, `get_activity_logs`, `get_board_summary`) strictly bound to the backend-verified `tenantId`.
