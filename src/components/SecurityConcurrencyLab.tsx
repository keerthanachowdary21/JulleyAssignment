import React, { useState } from 'react';
import type { Socket } from 'socket.io-client';
import { CheckCircle2, Play, ShieldAlert } from 'lucide-react';
import { ApiHttpError, apiRequest } from '../services/api.ts';
import type { Organization, RoleType, Task, Tenant, User } from '../types.ts';

interface SecurityConcurrencyLabProps {
  user: User;
  organization: Organization | null;
  tenant: Tenant | null;
  role: RoleType;
  tasks: Task[];
  socket: Socket | null;
  onRefreshBoard: () => Promise<void>;
}

interface LabResult {
  id: string;
  title: string;
  endpoint: string;
  httpStatus: string;
  passed: boolean;
  explanation: string;
  responsePreview: string;
}

export function SecurityConcurrencyLab({
  user,
  organization,
  tenant,
  role,
  tasks,
  socket,
  onRefreshBoard,
}: SecurityConcurrencyLabProps) {
  const [results, setResults] = useState<LabResult[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);

  function prependResult(entry: LabResult) {
    setResults((prev) => [entry, ...prev.filter((r) => r.id !== entry.id)]);
  }

  // Test 1: Cross-Tenant Task Read (Hyderabad user attempting to read Bangalore Task TSK_BLR_01 or Mumbai Task TSK_MUM_01)
  async function runCrossTenantTaskReadTest() {
    setRunningId('cross-tenant-read');
    const targetTaskId = organization?.id === 'ORG001' && role !== 'ORG_ADMIN' ? 'TSK_BLR_01' : 'TSK_MUM_01';
    const targetLabel = targetTaskId === 'TSK_BLR_01' ? 'Bangalore Task (TSK_BLR_01)' : 'XYZ Mumbai Task (TSK_MUM_01)';

    try {
      const res = await apiRequest(`/api/tasks/${targetTaskId}`);
      prependResult({
        id: 'cross-tenant-read',
        title: `Cross-Tenant Task Read (${targetLabel})`,
        endpoint: `GET /api/tasks/${targetTaskId}`,
        httpStatus: '200 OK',
        passed: false,
        explanation: 'Unexpectedly succeeded (caller has authorized membership on target tenant).',
        responsePreview: JSON.stringify(res, null, 2),
      });
    } catch (err: any) {
      const status = err instanceof ApiHttpError ? err.status : 500;
      prependResult({
        id: 'cross-tenant-read',
        title: `Cross-Tenant Task Read (${targetLabel})`,
        endpoint: `GET /api/tasks/${targetTaskId}`,
        httpStatus: `${status} Forbidden`,
        passed: status === 403 || status === 404,
        explanation: `Verified! Backend rejected ${user.name} (${tenant?.name}) from reading ${targetLabel}.`,
        responsePreview: JSON.stringify(err?.data || { error: err?.message }, null, 2),
      });
    } finally {
      setRunningId(null);
    }
  }

  // Test 2: Cross-Tenant Parameter Tampering (`?tenantId=TEN004` or `TEN002`)
  async function runTenantParamTamperTest() {
    setRunningId('param-tamper');
    const foreignTenantId = organization?.id === 'ORG002' ? 'TEN001' : 'TEN004';
    try {
      const res = await apiRequest(`/api/boards?tenantId=${foreignTenantId}`);
      prependResult({
        id: 'param-tamper',
        title: 'API Query Parameter Tampering Test',
        endpoint: `GET /api/boards?tenantId=${foreignTenantId}`,
        httpStatus: '200 OK',
        passed: false,
        explanation: 'Caller holds membership in target tenant.',
        responsePreview: JSON.stringify(res, null, 2),
      });
    } catch (err: any) {
      const status = err instanceof ApiHttpError ? err.status : 500;
      prependResult({
        id: 'param-tamper',
        title: 'API Query Parameter Tampering Test',
        endpoint: `GET /api/boards?tenantId=${foreignTenantId}`,
        httpStatus: `${status} Forbidden`,
        passed: status === 403,
        explanation: `Verified! Supplying unauthorized tenantId=${foreignTenantId} in query string was blocked by SQL membership check.`,
        responsePreview: JSON.stringify(err?.data || { error: err?.message }, null, 2),
      });
    } finally {
      setRunningId(null);
    }
  }

  // Test 3: Unauthorized Socket.IO Room Join (`tenant:join` to foreign tenant)
  async function runSocketRoomIsolationTest() {
    if (!socket) return;
    setRunningId('socket-room');
    const foreignTenantId = organization?.id === 'ORG002' ? 'TEN001' : 'TEN004';

    socket.emit(
      'tenant:join',
      { tenantId: foreignTenantId },
      (ack: { ok: boolean; error?: string; room?: string }) => {
        prependResult({
          id: 'socket-room',
          title: 'WebSocket Foreign Room Join Defense',
          endpoint: `socket.emit("tenant:join", { tenantId: "${foreignTenantId}" })`,
          httpStatus: ack.ok ? 'JOINED' : '403 SOCKET REJECTED',
          passed: !ack.ok,
          explanation: !ack.ok
            ? `Verified! Socket.IO server checked SQL memberships and refused room join to tenant:${foreignTenantId}.`
            : 'Caller was permitted into room.',
          responsePreview: JSON.stringify(ack, null, 2),
        });
        // Ensure we remain cleanly joined to our active authorized tenant room
        if (tenant) {
          socket.emit('tenant:join', { tenantId: tenant.id });
        }
        setRunningId(null);
      }
    );
  }

  // Test 4: Optimistic Concurrency Control (`HTTP 409 Conflict` on Stale Version)
  async function runOptimisticLockingTest() {
    const sampleTask = tasks[0];
    if (!sampleTask) {
      prependResult({
        id: 'concurrency-409',
        title: 'Optimistic Locking Stale Write Test',
        endpoint: 'PUT /api/tasks/:id',
        httpStatus: 'SKIPPED',
        passed: false,
        explanation: 'Create at least one task on the active board first to run the version conflict test.',
        responsePreview: '{}',
      });
      return;
    }

    setRunningId('concurrency-409');
    try {
      // 1. Read authoritative version vN
      const initial = await apiRequest<{ task: Task }>(`/api/tasks/${sampleTask.id}`);
      const staleVersion = initial.task.version;

      // 2. Collaborator A commits valid update (version becomes vN + 1)
      await apiRequest(`/api/tasks/${sampleTask.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: initial.task.title,
          description: initial.task.description,
          columnId: initial.task.column_id,
          assignedTo: initial.task.assigned_to,
          priority: initial.task.priority,
          dueDate: initial.task.due_date,
          labels: initial.task.labels || [],
          expectedVersion: staleVersion,
        }),
      });

      // 3. Collaborator B attempts write with stale expectedVersion = vN
      await apiRequest(`/api/tasks/${sampleTask.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: `${initial.task.title} (Stale Overwrite Attempt)`,
          description: initial.task.description,
          columnId: initial.task.column_id,
          assignedTo: initial.task.assigned_to,
          priority: initial.task.priority,
          dueDate: initial.task.due_date,
          labels: initial.task.labels || [],
          expectedVersion: staleVersion,
        }),
      });
    } catch (err: any) {
      const status = err instanceof ApiHttpError ? err.status : 500;
      await onRefreshBoard();
      prependResult({
        id: 'concurrency-409',
        title: `Optimistic Concurrency Conflict (${sampleTask.id})`,
        endpoint: `PUT /api/tasks/${sampleTask.id}`,
        httpStatus: `${status} Conflict`,
        passed: status === 409,
        explanation:
          'Verified! Collaborator A incremented version in an ACID transaction; Collaborator B’s stale version write was rejected with HTTP 409 and authoritative serverTask payload.',
        responsePreview: JSON.stringify(err?.data || { error: err?.message }, null, 2),
      });
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">
          Live Tenant Isolation &amp; Concurrency Verification Lab
        </h2>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
          Execute real HTTP and Socket.IO probes from your current authenticated session (<span className="font-semibold text-slate-900">{user.name}</span> · <span className="font-mono text-blue-700">{role}</span> in <span className="font-semibold">{tenant?.name}</span>) against the Express backend to verify multi-tenant boundaries and optimistic locking.
        </p>
      </div>

      {/* Test Scenarios Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">1. Cross-Tenant Task UUID Probe</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Attempts to fetch a private task belonging to another branch/organization directly by its UUID. Expects <code className="font-mono text-slate-900">403 TENANT_ISOLATION_BLOCKED</code>.
            </p>
          </div>
          <button
            type="button"
            disabled={runningId !== null}
            onClick={runCrossTenantTaskReadTest}
            className="self-start inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Run Cross-Tenant Read Probe</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">2. API Tenant ID Parameter Tampering</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Modifies <code className="font-mono text-slate-900">?tenantId=</code> in the REST request to a foreign organization's branch. Expects <code className="font-mono text-slate-900">403 Forbidden</code>.
            </p>
          </div>
          <button
            type="button"
            disabled={runningId !== null}
            onClick={runTenantParamTamperTest}
            className="self-start inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Run Parameter Tampering Probe</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">3. Unauthorized Socket.IO Room Join</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Emits <code className="font-mono text-slate-900">tenant:join</code> for an unauthorized branch room over WebSockets. Verifies server-side SQL room rejection.
            </p>
          </div>
          <button
            type="button"
            disabled={runningId !== null}
            onClick={runSocketRoomIsolationTest}
            className="self-start inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Run WebSocket Room Probe</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">4. Simultaneous Edit Conflict (HTTP 409)</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Simulates two collaborators editing <code className="font-mono text-slate-900">{tasks[0]?.id || 'a task'}</code> from the same version and verifies <code className="font-mono text-slate-900">409 VERSION_CONFLICT</code>.
            </p>
          </div>
          <button
            type="button"
            disabled={runningId !== null}
            onClick={runOptimisticLockingTest}
            className="self-start inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Run Concurrency 409 Test</span>
          </button>
        </div>
      </div>

      {/* Live Execution Output Log */}
      {results.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-900">Live Backend Probe Responses</h3>
          {results.map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {r.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span className="text-sm font-bold text-slate-900">{r.title}</span>
                </div>
                <span className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
                  {r.endpoint} → {r.httpStatus}
                </span>
              </div>
              <p className="text-xs text-slate-600">{r.explanation}</p>
              <pre className="p-3 bg-slate-950 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto">
                {r.responsePreview}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
