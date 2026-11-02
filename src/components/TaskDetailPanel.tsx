import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Trash2, X } from 'lucide-react';
import { ApiHttpError, apiRequest } from '../services/api.ts';
import type { ActivityLog, BoardColumn, PriorityType, Task, TenantMember } from '../types.ts';

interface TaskDetailPanelProps {
  task: Task | null;
  columns: BoardColumn[];
  members: TenantMember[];
  onClose: () => void;
  onTaskSaved: (updated: Task) => void;
  onTaskDeleted: (taskId: string) => void;
}

export function TaskDetailPanel({
  task,
  columns,
  members,
  onClose,
  onTaskSaved,
  onTaskDeleted,
}: TaskDetailPanelProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [priority, setPriority] = useState<PriorityType>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [expectedVersion, setExpectedVersion] = useState(1);

  const [taskLogs, setTaskLogs] = useState<ActivityLog[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictServerTask, setConflictServerTask] = useState<Task | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description || '');
    setColumnId(task.column_id);
    setAssignedTo(task.assigned_to || '');
    setPriority(task.priority);
    setDueDate(task.due_date || '');
    setLabelsText((task.labels || []).join(', '));
    setExpectedVersion(task.version);
    setError(null);
    setConflictServerTask(null);
    setConfirmDelete(false);

    apiRequest<{ task: Task; activityLogs: ActivityLog[] }>(`/api/tasks/${task.id}`)
      .then((res) => {
        setTaskLogs(res.activityLogs || []);
      })
      .catch(() => {});
  }, [task?.id]);

  if (!task) return null;

  async function submitSave(versionToUse: number) {
    if (!task) return;
    setSaving(true);
    setError(null);
    try {
      const labels = labelsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await apiRequest<{ task: Task }>(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title,
          description,
          columnId,
          assignedTo: assignedTo || null,
          priority,
          dueDate: dueDate || null,
          labels,
          expectedVersion: versionToUse,
        }),
      });

      setExpectedVersion(res.task.version);
      setConflictServerTask(null);
      onTaskSaved(res.task);

      const detailRes = await apiRequest<{ activityLogs: ActivityLog[] }>(`/api/tasks/${task.id}`);
      setTaskLogs(detailRes.activityLogs || []);
    } catch (err: any) {
      if (err instanceof ApiHttpError && err.status === 409 && err.data?.serverTask) {
        setConflictServerTask(err.data.serverTask as Task);
        setError(err.message);
      } else {
        setError(err?.message || 'Failed to update task.');
      }
    } finally {
      setSaving(false);
    }
  }

  /**
   * Demonstrates Scenario 1 from Section 8 of the Assignment Guide:
   * Bumps the server task version behind the scenes while keeping this panel's expectedVersion at its older value,
   * so clicking Save triggers a real HTTP 409 Conflict from the backend!
   */
  async function handleSimulateConcurrentEdit() {
    if (!task) return;
    setError(null);
    try {
      const fresh = await apiRequest<{ task: Task }>(`/api/tasks/${task.id}`);
      const currentServer = fresh.task;
      await apiRequest(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: `${currentServer.title} (Edited by Teammate)`,
          description: currentServer.description,
          columnId: currentServer.column_id,
          assignedTo: currentServer.assigned_to,
          priority: currentServer.priority,
          dueDate: currentServer.due_date,
          labels: currentServer.labels || [],
          expectedVersion: currentServer.version,
        }),
      });
      // Notice we intentionally keep `expectedVersion` in this form at the older version!
      setError(
        `Simulated teammate saved version v${currentServer.version + 1} on the server while your open form still holds v${expectedVersion}. Click "Save Changes" below to observe HTTP 409 Conflict detection.`
      );
    } catch (err: any) {
      setError(err?.message || 'Could not simulate concurrent edit.');
    }
  }

  function handleLoadLatestFromConflict() {
    if (!conflictServerTask) return;
    setTitle(conflictServerTask.title);
    setDescription(conflictServerTask.description || '');
    setColumnId(conflictServerTask.column_id);
    setAssignedTo(conflictServerTask.assigned_to || '');
    setPriority(conflictServerTask.priority);
    setDueDate(conflictServerTask.due_date || '');
    setLabelsText((conflictServerTask.labels || []).join(', '));
    setExpectedVersion(conflictServerTask.version);
    onTaskSaved(conflictServerTask);
    setConflictServerTask(null);
    setError(null);
  }

  async function handleDelete() {
    if (!task) return;
    setSaving(true);
    try {
      await apiRequest(`/api/tasks/${task.id}`, { method: 'DELETE' });
      onTaskDeleted(task.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete task.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/35">
      <div className="w-full max-w-xl bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
            <span className="font-mono text-slate-700 truncate">{task.id}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-blue-700 font-semibold">
              Lock Version v{expectedVersion}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close task details"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* HTTP 409 Optimistic Concurrency Resolution Box */}
          {conflictServerTask && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-amber-950">
                    HTTP 409 Conflict — Concurrent Edit Detected
                  </h4>
                  <p className="text-xs text-amber-900 leading-relaxed">
                    Your form attempted to save against <code className="font-mono">v{expectedVersion}</code>, but another collaborator already committed <code className="font-mono">v{conflictServerTask.version}</code>.
                  </p>
                </div>
              </div>

              <div className="bg-white border border-amber-200 rounded-lg p-3 text-xs space-y-1">
                <p className="font-semibold text-slate-800">
                  Server Version (v{conflictServerTask.version}):
                </p>
                <p className="text-slate-700">Title: {conflictServerTask.title}</p>
                <p className="text-slate-600">
                  Priority: {conflictServerTask.priority} · Column: {conflictServerTask.column_name}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleLoadLatestFromConflict}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Load Latest Server Version (v{conflictServerTask.version})</span>
                </button>
                <button
                  type="button"
                  onClick={() => submitSave(conflictServerTask.version)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Force Overwrite with My Draft (v{conflictServerTask.version + 1})
                </button>
              </div>
            </div>
          )}

          {error && !conflictServerTask && (
            <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-relaxed">
              {error}
            </div>
          )}

          <form
            id="task-edit-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitSave(expectedVersion);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Task Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2 text-sm font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Description
              </label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Document acceptance criteria, API dependencies, or branch notes..."
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Workflow Status
                </label>
                <select
                  value={columnId}
                  onChange={(e) => setColumnId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as PriorityType)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Assigned Employee (Branch Scoped)
                </label>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Labels (comma separated)
              </label>
              <input
                type="text"
                value={labelsText}
                onChange={(e) => setLabelsText(e.target.value)}
                placeholder="Backend, Auth, Security"
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </form>

          {/* Concurrency Test Trigger + Metadata */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <div className="space-y-0.5 font-mono tabular-nums">
              <div>Created: {task.created_at.slice(0, 16).replace('T', ' ')}</div>
              <div>Updated: {task.updated_at.slice(0, 16).replace('T', ' ')}</div>
            </div>

            <button
              type="button"
              onClick={handleSimulateConcurrentEdit}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Simulate Teammate Edit (Test 409)
            </button>
          </div>

          {/* Task Activity History */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <h3 className="text-xs font-bold text-slate-900">Task Audit History</h3>
            {taskLogs.length === 0 ? (
              <p className="text-xs text-slate-500">No recorded changes for this task yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {taskLogs.map((log) => (
                  <div key={log.id} className="px-3.5 py-2.5 text-xs flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900">{log.user_name}</span>{' '}
                      <span className="text-slate-600">{log.action.toLowerCase()} this task</span>
                      {log.details?.to && (
                        <span className="text-slate-500">
                          {' '}
                          ({log.details.from} → {log.details.to})
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                      {log.created_at.slice(11, 19)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleDelete}
                className="px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer whitespace-nowrap"
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Task</span>
            </button>
          )}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Close
            </button>
            <button
              type="submit"
              form="task-edit-form"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
