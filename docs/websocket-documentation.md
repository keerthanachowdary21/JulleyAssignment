# WebSocket (Socket.IO) Real-Time Protocol Documentation

## 1. Connection & JWT Authentication Handshake

The Socket.IO server runs on the same HTTP server and port as the Express REST API. Every WebSocket connection is authenticated during the handshake before any event handlers attach:

```typescript
import { io } from "socket.io-client";

const socket = io(window.location.origin, {
  auth: {
    token: "<jwt_access_token>",
  },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});
```

If `auth.token` is missing, expired, or invalid, the server rejects the handshake immediately via `io.use(...)`.

---

## 2. Tenant-Scoped Room Authorization (`tenant:<tenantId>`)

Clients **never** receive global broadcasts, and cannot join arbitrary rooms without SQL verification.

1. Client emits `tenant:join` with `{ tenantId: "TEN001" }` and an acknowledgement callback.
2. Backend queries `memberships` in SQL (`resolveTenantAccess(socket.data.user.id, tenantId)`).
3. **Authorized**:
   - Leaves any previously joined `tenant:*` rooms on that socket (preventing stale cross-branch events when switching branches).
   - Joins `tenant:TEN001`.
   - Registers `socket.id` inside the multi-tab presence tracker `Map<tenantId, Map<userId, Set<socketId>>>`.
   - Broadcasts `presence:update` to `tenant:TEN001` and returns `{ ok: true, room: "tenant:TEN001", presence: [...] }`.
4. **Unauthorized**:
   - Refuses `socket.join(...)`.
   - Emits `tenant:error` and invokes acknowledgement with `{ ok: false, error: "403 Forbidden: User ... is not authorized to join room tenant:TEN002." }`.

---

## 3. Event Reference Matrix

| Event Name | Direction | Room Scope | Payload Summary & Idempotency |
| --- | --- | --- | --- |
| `tenant:join` | Client → Server | Handshake | `{ tenantId }` with ack `{ ok, room, presence, error }` |
| `tenant:error` | Server → Client | Individual Socket | `{ ok: false, error }` emitted when unauthorized room access is attempted |
| `task:created` | Server → Client | `tenant:<id>` | `{ task }` — Client checks `tasks.some(t => t.id === task.id)` before inserting (idempotent) |
| `task:updated` | Server → Client | `tenant:<id>` | `{ task }` — Replaces task matching `task.id` if `task.version` is newer/equal |
| `task:moved` | Server → Client | `tenant:<id>` | `{ task, boardId, boardTasks }` — Reconciles authoritative column & position ordering |
| `task:deleted` | Server → Client | `tenant:<id>` | `{ taskId, boardId }` — Removes task card if present (no-op if already removed) |
| `board:created` | Server → Client | `tenant:<id>` | `{ board }` — Appends newly created board to sidebar/selector |
| `board:updated` | Server → Client | `tenant:<id>` | `{ board }` — Updates board metadata |
| `board:deleted` | Server → Client | `tenant:<id>` | `{ boardId }` — Removes deleted board |
| `column:created` | Server → Client | `tenant:<id>` | `{ column }` — Appends new workflow column |
| `column:updated` | Server → Client | `tenant:<id>` | `{ column }` — Updates column title |
| `column:deleted` | Server → Client | `tenant:<id>` | `{ columnId, boardId }` — Removes deleted column |
| `activity:created` | Server → Client | `tenant:<id>` | `{ id, user_name, entity_type, action, details, created_at }` — Prepends to live audit log |
| `presence:online` | Server → Client | `tenant:<id>` | `{ tenantId, user }` — Fired when a user's first browser tab joins the tenant |
| `presence:offline` | Server → Client | `tenant:<id>` | `{ tenantId, userId }` — Fired only after a user's *last* active tab disconnects |
| `presence:update` | Server → Client | `tenant:<id>` | `{ tenantId, onlineUsers: PresenceEntry[] }` — Authoritative online roster with `tabCount` |

---

## 4. Multi-Tab Presence & Network Disconnection Recovery

### Multi-Tab Tracking
Each user's presence inside a tenant stores a `Set<socketId>`. If Rahul opens two browser tabs on the Hyderabad board (`tabCount: 2`) and closes Tab 1, `sockets.size` becomes `1` — Rahul remains online for Priya and Arjun without false offline flicker.

### Network Drop & Reconnection Flow
1. On `disconnect`, the React UI displays an explicit connection status banner (`Reconnecting to live sync...`).
2. When connectivity returns (`connect` event), the client automatically:
   - Re-emits `tenant:join` for the active `tenantId` to re-authorize room membership.
   - Executes an HTTP `GET /api/boards/:activeBoardId` and `GET /api/activity-logs?tenantId=:activeTenantId` state resynchronization so any events missed while offline are reconciled from the authoritative SQL database.
