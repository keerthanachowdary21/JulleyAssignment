import React, { useMemo, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { apiRequest } from '../services/api.ts';
import type { ActivityLog, RoleType, Tenant, TenantMember, User } from '../types.ts';

interface ActivityAuditViewProps {
  tenant: Tenant | null;
  logs: ActivityLog[];
}

export function ActivityAuditView({ tenant, logs }: ActivityAuditViewProps) {
  const [actionFilter, setActionFilter] = useState<'ALL' | 'Created' | 'Moved' | 'Updated' | 'Deleted'>('ALL');

  const filteredLogs = useMemo(() => {
    if (actionFilter === 'ALL') return logs;
    return logs.filter((l) => l.action === actionFilter);
  }, [logs, actionFilter]);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Branch Activity Audit Log — {tenant?.name}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable, real-time history scoped strictly to <code className="font-mono">tenant_id = {tenant?.id}</code>.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['ALL', 'Created', 'Moved', 'Updated', 'Deleted'] as const).map((act) => (
            <button
              key={act}
              type="button"
              onClick={() => setActionFilter(act)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                actionFilter === act
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {act === 'ALL' ? 'All Actions' : act}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No matching audit records recorded in {tenant?.name} yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action &amp; Entity</th>
                  <th className="py-3 px-4">Change Details</th>
                  <th className="py-3 px-4 text-right">Timestamp (UTC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                      {log.user_name}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                      <span className="font-semibold">{log.action}</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="font-mono text-slate-500">{log.entity_type}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                      {Object.entries(log.details || {})
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(' · ') || log.entity_id}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {log.created_at.slice(0, 19).replace('T', ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface TeamRbacViewProps {
  tenant: Tenant | null;
  currentUser: User;
  role: RoleType;
  members: TenantMember[];
  directoryUsers: User[];
  onMembersUpdated: () => Promise<void>;
}

export function TeamRbacView({
  tenant,
  currentUser,
  role,
  members,
  directoryUsers,
  onMembersUpdated,
}: TeamRbacViewProps) {
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<RoleType>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManage = role === 'ORG_ADMIN' || role === 'TENANT_ADMIN';

  async function handleAssignMember(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant || !selectedEmail.trim()) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await apiRequest('/api/memberships', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: tenant.id,
          email: selectedEmail.trim(),
          role: selectedRole,
        }),
      });
      setSuccess(`Updated ${selectedEmail} with role ${selectedRole} in ${tenant.name}.`);
      setSelectedEmail('');
      await onMembersUpdated();
    } catch (err: any) {
      setError(err?.message || 'Failed to update membership.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!tenant) return;
    setError(null);
    setSuccess(null);
    try {
      await apiRequest(`/api/memberships/${userId}?tenantId=${tenant.id}`, {
        method: 'DELETE',
      });
      await onMembersUpdated();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove member.');
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Team Memberships &amp; RBAC — {tenant?.name}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Your active branch role: <span className="font-mono font-semibold text-blue-700">{role}</span>. Backend enforces role gates on every API &amp; Socket request.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium">
          {success}
        </div>
      )}

      {/* Add / Update Branch Member Form */}
      {canManage && (
        <form
          onSubmit={handleAssignMember}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <h3 className="text-xs font-bold text-slate-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-600" />
            <span>Grant or Update Branch Access in {tenant?.name}</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-6">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Employee Email
              </label>
              <input
                type="email"
                list="directory-emails"
                required
                value={selectedEmail}
                onChange={(e) => setSelectedEmail(e.target.value)}
                placeholder="Select or type registered employee email..."
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <datalist id="directory-emails">
                {directoryUsers.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.name}
                  </option>
                ))}
              </datalist>
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Permission Role
              </label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as RoleType)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="MEMBER">MEMBER</option>
                <option value="TENANT_ADMIN">TENANT_ADMIN</option>
                {role === 'ORG_ADMIN' && <option value="ORG_ADMIN">ORG_ADMIN</option>}
              </select>
            </div>

            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2 px-4 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                {submitting ? 'Saving...' : 'Assign Role'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Active Branch Members Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900">
            Authorized Employees in {tenant?.name} ({members.length})
          </h3>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th className="py-3 px-5">Employee</th>
              <th className="py-3 px-5">Email</th>
              <th className="py-3 px-5">Branch Role</th>
              {canManage && <th className="py-3 px-5 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {members.map((m) => (
              <tr key={m.user_id} className="hover:bg-slate-50/70">
                <td className="py-3 px-5 font-semibold text-slate-900">
                  {m.name} {m.user_id === currentUser.id && <span className="text-slate-400 font-normal">(You)</span>}
                </td>
                <td className="py-3 px-5 font-mono text-slate-600">{m.email}</td>
                <td className="py-3 px-5 font-mono font-semibold text-blue-700">{m.role}</td>
                {canManage && (
                  <td className="py-3 px-5 text-right">
                    {m.user_id !== currentUser.id && m.role !== 'ORG_ADMIN' ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.user_id)}
                        className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 font-medium cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Revoke</span>
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* RBAC Specification Reference */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-xs font-bold text-slate-900">
            Backend RBAC Enforcement Matrix
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <th className="py-2.5 px-5">Operation</th>
                <th className="py-2.5 px-5">ORG_ADMIN</th>
                <th className="py-2.5 px-5">TENANT_ADMIN</th>
                <th className="py-2.5 px-5">MEMBER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-2.5 px-5">Create / Rename / Delete Branch Tenants</td>
                <td className="py-2.5 px-5 text-emerald-700 font-medium">Permitted</td>
                <td className="py-2.5 px-5 text-slate-400">Blocked (403)</td>
                <td className="py-2.5 px-5 text-slate-400">Blocked (403)</td>
              </tr>
              <tr>
                <td className="py-2.5 px-5">Create / Delete Kanban Boards &amp; Columns</td>
                <td className="py-2.5 px-5 text-emerald-700 font-medium">Permitted</td>
                <td className="py-2.5 px-5 text-emerald-700 font-medium">Permitted</td>
                <td className="py-2.5 px-5 text-slate-400">Blocked (403)</td>
              </tr>
              <tr>
                <td className="py-2.5 px-5">Manage Branch Employee Memberships</td>
                <td className="py-2.5 px-5 text-emerald-700 font-medium">Permitted</td>
                <td className="py-2.5 px-5 text-emerald-700 font-medium">Permitted</td>
                <td className="py-2.5 px-5 text-slate-400">Blocked (403)</td>
              </tr>
              <tr>
                <td className="py-2.5 px-5">Create, Update, Move &amp; Delete Authorized Tasks</td>
                <td className="py-2.5 px-5 text-emerald-700 font-medium">Permitted</td>
                <td className="py-2.5 px-5 text-emerald-700 font-medium">Permitted</td>
                <td className="py-2.5 px-5 text-emerald-700 font-medium">Permitted</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
