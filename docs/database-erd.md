# Database Schema & Entity-Relationship Diagram (ERD)

## 1. Entity Hierarchy & Isolation Invariant

The database enforces strict multi-organization and multi-tenant isolation across **8 normalized relational tables**:

`organizations` (1) ──< `tenants` (1) ──< `boards` (1) ──< `columns` (1) ──< `tasks`

- **`users`** connect to **`organizations`** and **`tenants`** via **`memberships`** (`ORG_ADMIN`, `TENANT_ADMIN`, `MEMBER`).
- Every business record (`boards`, `columns`, `tasks`, `activity_logs`) carries a mandatory `tenant_id` foreign key so every query, mutation, and transaction enforces `WHERE id = $1 AND tenant_id = $2`.

---

## 2. Mermaid Entity-Relationship Diagram

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ TENANTS : "owns branches"
    ORGANIZATIONS ||--o{ MEMBERSHIPS : "grants access"
    ORGANIZATIONS ||--o{ BOARDS : "scopes"
    USERS ||--o{ MEMBERSHIPS : "holds roles"
    USERS ||--o{ BOARDS : "creates"
    USERS ||--o{ TASKS : "assigned_to"
    USERS ||--o{ ACTIVITY_LOGS : "performs"
    TENANTS ||--o{ MEMBERSHIPS : "branch role"
    TENANTS ||--o{ BOARDS : "isolates"
    TENANTS ||--o{ COLUMNS : "isolates"
    TENANTS ||--o{ TASKS : "isolates"
    TENANTS ||--o{ ACTIVITY_LOGS : "audits"
    BOARDS ||--o{ COLUMNS : "contains ordered"
    BOARDS ||--o{ TASKS : "contains"
    COLUMNS ||--o{ TASKS : "groups ordered"

    ORGANIZATIONS {
        uuid id PK
        varchar name
        timestamptz created_at
        timestamptz updated_at
    }

    TENANTS {
        uuid id PK
        uuid organization_id FK
        varchar name
        timestamptz created_at
    }

    USERS {
        uuid id PK
        varchar name
        varchar email UK
        varchar password_hash
        timestamptz created_at
    }

    MEMBERSHIPS {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK
        uuid tenant_id FK "Nullable for ORG_ADMIN"
        varchar role "ORG_ADMIN | TENANT_ADMIN | MEMBER"
        timestamptz created_at
    }

    BOARDS {
        uuid id PK
        uuid organization_id FK
        uuid tenant_id FK "Isolation Key"
        varchar name
        text description
        uuid created_by FK
        timestamptz created_at
    }

    COLUMNS {
        uuid id PK
        uuid board_id FK
        uuid tenant_id FK "Isolation Key"
        varchar name
        integer position
    }

    TASKS {
        uuid id PK
        uuid board_id FK
        uuid column_id FK
        uuid tenant_id FK "Isolation Key"
        varchar title
        text description
        uuid assigned_to FK
        varchar priority "LOW | MEDIUM | HIGH | URGENT"
        date due_date
        jsonb labels
        integer position "Column ordering"
        integer version "Optimistic lock counter"
        timestamptz created_at
        timestamptz updated_at
    }

    ACTIVITY_LOGS {
        uuid id PK
        uuid tenant_id FK "Isolation Key"
        uuid user_id FK
        varchar entity_type
        uuid entity_id
        varchar action
        jsonb details
        timestamptz created_at
    }
```

---

## 3. Indexing & Concurrency Design

| Index Name | Target Columns | Purpose |
| --- | --- | --- |
| `idx_tenants_organization_id` | `tenants(organization_id)` | Fast branch lookup when switching organizations |
| `idx_memberships_org_user` | `memberships(organization_id, user_id)` | Sub-millisecond RBAC authorization check on every API & Socket request |
| `idx_memberships_tenant_id` | `memberships(tenant_id)` | Team member roster queries |
| `idx_boards_tenant_id` | `boards(tenant_id)` | Tenant-isolated board listing |
| `idx_columns_board_tenant` | `columns(board_id, tenant_id, position)` | Ordered Kanban column rendering |
| `idx_tasks_column_position` | `tasks(tenant_id, column_id, position)` | Ordered task rendering & transactional drag-and-drop re-indexing |
| `idx_activity_logs_tenant_created` | `activity_logs(tenant_id, created_at DESC)` | Reverse-chronological audit log feed |
