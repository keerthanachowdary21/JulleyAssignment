import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import {
  Activity,
  BookOpen,
  Bot,
  Building2,
  FolderKanban,
  GitBranch,
  LogOut,
  Menu,
  Plus,
  RotateCcw,
  ShieldCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { ApiHttpError, apiRequest, getStoredToken, setStoredToken } from './services/api.ts';
import type {
  ActivityLog,
  Board,
  BoardColumn,
  DemoAccount,
  Organization,
  PresenceEntry,
  PriorityType,
  RoleType,
  Task,
  Tenant,
  TenantMember,
  User,
} from './types.ts';
import { AuthScreen } from './components/AuthScreen.tsx';
import { KanbanWorkspace } from './components/KanbanWorkspace.tsx';
import { TaskDetailPanel } from './components/TaskDetailPanel.tsx';
import { ActivityAuditView, TeamRbacView } from './components/TeamAndAuditViews.tsx';
import { AiAssistantDrawer } from './components/AiAssistantDrawer.tsx';
import { SecurityConcurrencyLab } from './components/SecurityConcurrencyLab.tsx';
import { DocsPortal } from './components/DocsPortal.tsx';

type WorkspaceSection = 'kanban' | 'activity' | 'team' | 'lab' | 'docs';

export default function App() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [publicDocsOpen, setPublicDocsOpen] = useState(false);

  // Active Multi-Tenant Hierarchy State
  const [activeOrgId, setActiveOrgId] = useState<string>('');
  const [activeTenantId, setActiveTenantId] = useState<string>('');
  const [activeBoardId, setActiveBoardId] = useState<string>('');
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('kanban');

  // Tenant-Scoped Data State
  const [boards, setBoards] = useState<Board[]>([]);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<PresenceEntry[]>([]);
  const [tenantRole, setTenantRole] = useState<RoleType>('MEMBER');
  const [loadingBoard, setLoadingBoard] = useState(false);

  // Real-Time Socket State
  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const activeBoardIdRef = useRef<string>('');
  activeBoardIdRef.current = activeBoardId;
  const activeTenantIdRef = useRef<string>('');
  activeTenantIdRef.current = activeTenantId;

  // Drawers, Modals & Banners
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  // Creation Modals
  const [newTaskModalColId, setNewTaskModalColId] = useState<string | null>(null);
  const [newBoardModalOpen, setNewBoardModalOpen] = useState(false);
  const [newBranchModalOpen, setNewBranchModalOpen] = useState(false);
  const [newOrgModalOpen, setNewOrgModalOpen] = useState(false);

  // Quick Persona Switcher
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  const activeOrganization = useMemo(
    () => organizations.find((o) => o.id === activeOrgId) || null,
    [organizations, activeOrgId]
  );

  const activeTenant: Tenant | null = useMemo(
    () => activeOrganization?.tenants.find((t) => t.id === activeTenantId) || null,
    [activeOrganization, activeTenantId]
  );

  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) || null,
    [boards, activeBoardId]
  );

  function showNotice(tone: 'info' | 'error', text: string) {
    setBannerNotice({ tone, text });
    setTimeout(() => {
      setBannerNotice((curr) => (curr?.text === text ? null : curr));
    }, 5000);
  }

  function applyAuthSession(payload: { token?: string; user: User; organizations: Organization[] }) {
    if (payload.token) {
      setStoredToken(payload.token);
    }
    setUser(payload.user);
    const orgs = payload.organizations || [];
    setOrganizations(orgs);

    const firstOrg = orgs[0] || null;
    const firstTenant = firstOrg?.tenants[0] || null;
    setActiveOrgId(firstOrg?.id || '');
    setActiveTenantId(firstTenant?.id || '');
    setActiveBoardId('');
    setSelectedTask(null);
  }

  // Initial Session Bootstrap
  useEffect(() => {
    apiRequest<{ accounts: DemoAccount[] }>('/api/demo/accounts')
      .then((res) => setDemoAccounts(res.accounts || []))
      .catch(() => {});

    const existingToken = getStoredToken();
    if (!existingToken) {
      setBootstrapping(false);
      return;
    }

    apiRequest<{ user: User; organizations: Organization[] }>('/api/auth/me')
      .then((res) => {
        applyAuthSession(res);
      })
      .catch(() => {
        setStoredToken(null);
      })
      .finally(() => {
        setBootstrapping(false);
      });
  }, []);

  // Load Tenant Boards, Members, and Activity Logs whenever Active Tenant Changes
  const fetchTenantResources = useCallback(async (tenantId: string) => {
    if (!tenantId) return;
    setLoadingBoard(true);
    // Clear previous tenant state immediately so stale data is never shown
    setBoards([]);
    setColumns([]);
    setTasks([]);
    setActivityLogs([]);
    setMembers([]);
    setSelectedTask(null);

    try {
      const [boardsRes, logsRes, membersRes] = await Promise.all([
        apiRequest<{ boards: Board[]; role: RoleType }>(`/api/boards?tenantId=${tenantId}`),
        apiRequest<{ logs: ActivityLog[] }>(`/api/activity-logs?tenantId=${tenantId}`),
        apiRequest<{ members: TenantMember[]; directoryUsers: User[]; callerRole: RoleType }>(
          `/api/memberships?tenantId=${tenantId}`
        ),
      ]);

      setBoards(boardsRes.boards || []);
      setTenantRole(boardsRes.role || 'MEMBER');
      setActivityLogs(logsRes.logs || []);
      setMembers(membersRes.members || []);
      setDirectoryUsers(membersRes.directoryUsers || []);

      const nextBoardId = boardsRes.boards?.[0]?.id || '';
      setActiveBoardId(nextBoardId);
    } catch (err: any) {
      showNotice('error', err?.message || 'Failed to load branch workspace.');
      setLoadingBoard(false);
    }
  }, []);

  useEffect(() => {
    if (user && activeTenantId) {
      fetchTenantResources(activeTenantId);
    }
  }, [user?.id, activeTenantId, fetchTenantResources]);

  // Load Active Board Details (Columns + Tasks)
  const fetchActiveBoardDetail = useCallback(async (boardId: string) => {
    if (!boardId) {
      setColumns([]);
      setTasks([]);
      setLoadingBoard(false);
      return;
    }
    setLoadingBoard(true);
    try {
      const res = await apiRequest<{
        board: Board;
        columns: BoardColumn[];
        tasks: Task[];
        role: RoleType;
        onlineUsers: PresenceEntry[];
      }>(`/api/boards/${boardId}`);

      setColumns(res.columns || []);
      setTasks(res.tasks || []);
      setTenantRole(res.role);
      if (res.onlineUsers) {
        setOnlineUsers(res.onlineUsers);
      }
    } catch (err: any) {
      showNotice('error', err?.message || 'Failed to load board tasks.');
    } finally {
      setLoadingBoard(false);
    }
  }, []);

  useEffect(() => {
    if (user && activeBoardId) {
      fetchActiveBoardDetail(activeBoardId);
    } else if (user && !activeBoardId) {
      setLoadingBoard(false);
    }
  }, [user?.id, activeBoardId, fetchActiveBoardDetail]);

  // Socket.IO Connection & Real-Time Event Synchronization
  useEffect(() => {
    const token = getStoredToken();
    if (!user || !token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketConnected(false);
      return;
    }

    const socket = io(window.location.origin, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      const currentTenant = activeTenantIdRef.current;
      const currentBoard = activeBoardIdRef.current;
      if (currentTenant) {
        socket.emit(
          'tenant:join',
          { tenantId: currentTenant },
          (ack: { ok: boolean; presence?: PresenceEntry[] }) => {
            if (ack?.ok && ack.presence) {
              setOnlineUsers(ack.presence);
            }
          }
        );
        // Reconcile state after network reconnection
        if (currentBoard) {
          apiRequest<{ columns: BoardColumn[]; tasks: Task[] }>(`/api/boards/${currentBoard}`)
            .then((res) => {
              setColumns(res.columns || []);
              setTasks(res.tasks || []);
            })
            .catch(() => {});
        }
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('presence:update', (payload: { tenantId: string; onlineUsers: PresenceEntry[] }) => {
      if (payload.tenantId === activeTenantIdRef.current) {
        setOnlineUsers(payload.onlineUsers || []);
      }
    });

    // Idempotent real-time task listeners
    socket.on('task:created', ({ task }: { task: Task }) => {
      if (task.board_id !== activeBoardIdRef.current) return;
      setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]));
    });

    socket.on('task:updated', ({ task }: { task: Task }) => {
      if (task.board_id !== activeBoardIdRef.current) return;
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      setSelectedTask((curr) => (curr && curr.id === task.id ? task : curr));
    });

    socket.on('task:moved', ({ boardId, boardTasks }: { task: Task; boardId: string; boardTasks: Task[] }) => {
      if (boardId !== activeBoardIdRef.current) return;
      if (Array.isArray(boardTasks)) {
        setTasks(boardTasks);
      }
    });

    socket.on('task:deleted', ({ taskId, boardId }: { taskId: string; boardId: string }) => {
      if (boardId !== activeBoardIdRef.current) return;
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setSelectedTask((curr) => (curr && curr.id === taskId ? null : curr));
    });

    socket.on('column:created', ({ column }: { column: BoardColumn }) => {
      if (column.board_id !== activeBoardIdRef.current) return;
      setColumns((prev) => (prev.some((c) => c.id === column.id) ? prev : [...prev, column]));
    });

    socket.on('column:deleted', ({ columnId, boardId }: { columnId: string; boardId: string }) => {
      if (boardId !== activeBoardIdRef.current) return;
      setColumns((prev) => prev.filter((c) => c.id !== columnId));
    });

    socket.on('board:created', ({ board }: { board: Board }) => {
      if (board.tenant_id !== activeTenantIdRef.current) return;
      setBoards((prev) => (prev.some((b) => b.id === board.id) ? prev : [...prev, board]));
    });

    socket.on('board:deleted', ({ boardId }: { boardId: string }) => {
      setBoards((prev) => {
        const remaining = prev.filter((b) => b.id !== boardId);
        if (activeBoardIdRef.current === boardId) {
          setActiveBoardId(remaining[0]?.id || '');
        }
        return remaining;
      });
    });

    socket.on('activity:created', (log: ActivityLog) => {
      if (log.tenant_id !== activeTenantIdRef.current) return;
      setActivityLogs((prev) => (prev.some((l) => l.id === log.id) ? prev : [log, ...prev].slice(0, 60)));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.id]);

  // Join Authorized Socket.IO Room when switching Branches
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !activeTenantId) return;
    socket.emit(
      'tenant:join',
      { tenantId: activeTenantId },
      (ack: { ok: boolean; presence?: PresenceEntry[]; error?: string }) => {
        if (ack?.ok && ack.presence) {
          setOnlineUsers(ack.presence);
        }
      }
    );
  }, [activeTenantId]);

  // Organization & Tenant Switching Handlers
  function handleSwitchOrganization(newOrgId: string) {
    if (newOrgId === '__NEW_ORG__') {
      setNewOrgModalOpen(true);
      return;
    }
    const nextOrg = organizations.find((o) => o.id === newOrgId);
    if (!nextOrg) return;
    setActiveOrgId(nextOrg.id);
    const firstTenant = nextOrg.tenants[0];
    setActiveTenantId(firstTenant ? firstTenant.id : '');
    setActiveBoardId('');
  }

  function handleSwitchTenant(newTenantId: string) {
    if (newTenantId === activeTenantId) return;
    setActiveTenantId(newTenantId);
    setActiveBoardId('');
  }

  function handleSignOut() {
    setStoredToken(null);
    setUser(null);
    setOrganizations([]);
    setBoards([]);
    setColumns([]);
    setTasks([]);
    setOnlineUsers([]);
  }

  async function handleQuickPersonaSwitch(email: string) {
    const target = demoAccounts.find((a) => a.email === email);
    if (!target) return;
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: target.email, password: target.password }),
      });
      applyAuthSession(res);
      showNotice('info', `Switched session to ${target.name} (${target.role}).`);
    } catch (err: any) {
      showNotice('error', err?.message || 'Could not switch persona.');
    }
  }

  async function handleResetDatabase() {
    try {
      await apiRequest('/api/demo/reset', { method: 'POST' });
      const me = await apiRequest('/api/auth/me');
      applyAuthSession(me);
      showNotice('info', 'Reset database to clean multi-tenant sample data.');
    } catch (err: any) {
      showNotice('error', err?.message || 'Reset failed.');
    }
  }

  // Optimistic Drag-and-Drop Move with Server Reconciliation
  async function handleMoveTask(
    taskId: string,
    destinationColumnId: string,
    newPosition: number,
    expectedVersion: number
  ) {
    const previousTasks = tasks;

    // 1. Optimistic local state update
    setTasks((curr) => {
      const moving = curr.find((t) => t.id === taskId);
      if (!moving) return curr;
      const destCol = columns.find((c) => c.id === destinationColumnId);
      const others = curr.filter((t) => t.id !== taskId);
      const destSiblings = others
        .filter((t) => t.column_id === destinationColumnId)
        .sort((a, b) => a.position - b.position);
      const clampedIdx = Math.min(Math.max(newPosition - 1, 0), destSiblings.length);
      destSiblings.splice(clampedIdx, 0, {
        ...moving,
        column_id: destinationColumnId,
        column_name: destCol?.name || moving.column_name,
      });
      const reindexedDest = destSiblings.map((t, i) => ({ ...t, position: i + 1 }));
      const nonDest = others.filter((t) => t.column_id !== destinationColumnId);
      return [...nonDest, ...reindexedDest];
    });

    // 2. Commit move to server & check optimistic lock version
    try {
      const res = await apiRequest<{ task: Task; boardTasks: Task[] }>(`/api/tasks/${taskId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ destinationColumnId, newPosition, expectedVersion }),
      });
      if (res.boardTasks) {
        setTasks(res.boardTasks);
      }
    } catch (err: any) {
      // 3. Rollback / Reconcile on HTTP 409 Conflict or error
      setTasks(previousTasks);
      if (err instanceof ApiHttpError && err.status === 409) {
        showNotice('error', `${err.message} Board refreshed to latest server state.`);
        if (activeBoardId) {
          await fetchActiveBoardDetail(activeBoardId);
        }
      } else {
        showNotice('error', err?.message || 'Task move failed; restored previous position.');
      }
    }
  }

  async function handleCreateColumn(name: string) {
    if (!activeBoardId) return;
    try {
      const res = await apiRequest<{ column: BoardColumn }>('/api/columns', {
        method: 'POST',
        body: JSON.stringify({ boardId: activeBoardId, name }),
      });
      setColumns((prev) => (prev.some((c) => c.id === res.column.id) ? prev : [...prev, res.column]));
    } catch (err: any) {
      showNotice('error', err?.message || 'Could not add column.');
    }
  }

  async function handleDeleteColumn(columnId: string) {
    try {
      await apiRequest(`/api/columns/${columnId}`, { method: 'DELETE' });
      setColumns((prev) => prev.filter((c) => c.id !== columnId));
    } catch (err: any) {
      showNotice('error', err?.message || 'Could not delete column.');
    }
  }

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Loading workspace...
      </div>
    );
  }

  if (!user && publicDocsOpen) {
    return <DocsPortal isPublicMode onBackToApp={() => setPublicDocsOpen(false)} />;
  }

  if (!user) {
    return (
      <AuthScreen
        onAuthenticated={(payload) => applyAuthSession(payload)}
        onOpenPublicDocs={() => setPublicDocsOpen(true)}
      />
    );
  }

  const canCreateBoard = tenantRole === 'ORG_ADMIN' || tenantRole === 'TENANT_ADMIN';
  const canCreateBranch = activeOrganization?.isOrgAdmin === true;

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
        />
      )}

      {/* Workspace Sidebar (264px width per SaaS Dashboard Spec) */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-[264px] bg-white border-r border-slate-200 flex flex-col transition-transform lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            TenantFlow
          </span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-slate-500 hover:text-slate-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Hierarchy & Navigation */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* 1. Organization Selector */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <Building2 className="w-3.5 h-3.5" />
              <span>Organization</span>
            </label>
            <select
              value={activeOrgId}
              onChange={(e) => handleSwitchOrganization(e.target.value)}
              className="w-full px-3 py-2 text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
              <option value="__NEW_ORG__">+ Create New Organization...</option>
            </select>
          </div>

          {/* 2. Branch / Tenant Switcher */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <GitBranch className="w-3.5 h-3.5" />
                <span>Branches (Tenants)</span>
              </span>
              {canCreateBranch && (
                <button
                  type="button"
                  onClick={() => setNewBranchModalOpen(true)}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 cursor-pointer whitespace-nowrap"
                >
                  + Branch
                </button>
              )}
            </div>

            <div className="space-y-0.5">
              {activeOrganization?.tenants.map((t) => {
                const selected = t.id === activeTenantId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSwitchTenant(t.id)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer ${
                      selected
                        ? 'bg-blue-50 text-blue-800 font-semibold'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="text-[10px] font-mono text-slate-400">{t.id}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Boards in Active Branch */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <FolderKanban className="w-3.5 h-3.5" />
                <span>Branch Boards</span>
              </span>
              {canCreateBoard && (
                <button
                  type="button"
                  onClick={() => setNewBoardModalOpen(true)}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 cursor-pointer whitespace-nowrap"
                >
                  + Board
                </button>
              )}
            </div>

            <div className="space-y-0.5">
              {boards.map((b) => {
                const selected = b.id === activeBoardId && activeSection === 'kanban';
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setActiveBoardId(b.id);
                      setActiveSection('kanban');
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors truncate cursor-pointer ${
                      selected
                        ? 'bg-slate-900 text-white font-semibold'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Workspace Views & Deliverables */}
          <div className="pt-3 border-t border-slate-100 space-y-1">
            <button
              type="button"
              onClick={() => {
                setActiveSection('kanban');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeSection === 'kanban'
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <FolderKanban className="w-4 h-4 shrink-0" />
              <span>Kanban Board</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('activity');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeSection === 'activity'
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Activity className="w-4 h-4 shrink-0" />
                <span>Activity Audit</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {activityLogs.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('team');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeSection === 'team'
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Users className="w-4 h-4 shrink-0" />
                <span>Team &amp; RBAC</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {members.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('lab');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeSection === 'lab'
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0 text-blue-600" />
              <span>Isolation &amp; 409 Lab</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('docs');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeSection === 'docs'
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-4 h-4 shrink-0 text-blue-600" />
              <span>Docs &amp; ER Diagram</span>
            </button>
          </div>
        </div>

        {/* Sidebar Account & Demo Switcher Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/70 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">{user.name}</p>
              <p className="text-[11px] text-slate-500 font-mono truncate">
                {tenantRole} · {user.email}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign Out"
              className="p-1.5 text-slate-500 hover:text-red-600 rounded-lg hover:bg-white transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <select
              aria-label="Quick Switch Demo Persona"
              value={user.email}
              onChange={(e) => handleQuickPersonaSwitch(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 text-[11px] bg-white border border-slate-200 rounded-md text-slate-700 cursor-pointer"
            >
              {!demoAccounts.some((d) => d.email === user.email) && (
                <option value={user.email}>Current: {user.name}</option>
              )}
              {demoAccounts.map((acc) => (
                <option key={acc.email} value={acc.email}>
                  Switch: {acc.name.split(' ')[0]} ({acc.role})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleResetDatabase}
              title="Reset sample seed data"
              className="p-1.5 text-slate-500 hover:text-slate-900 bg-white border border-slate-200 rounded-md cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Contextual SaaS Top Header: Breadcrumb on Left, Presence + Primary Actions on Right */}
        <header className="px-6 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline truncate">
                {activeOrganization?.name}
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-800 truncate">
                {activeTenant?.name || 'Select Branch'}
              </span>
              {activeSection === 'kanban' && activeBoard && (
                <>
                  <span className="text-slate-300">/</span>
                  <span className="font-bold text-slate-900 truncate">{activeBoard.name}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Real WebSocket Room & Multi-Tab Presence Indicator */}
            <div className="hidden md:flex items-center gap-2.5 text-xs text-slate-600">
              {socketConnected ? (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-700 tabular-nums">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  <span>{onlineUsers.length} online</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Reconnecting...</span>
                </span>
              )}

              {onlineUsers.length > 0 && (
                <div className="flex -space-x-1.5">
                  {onlineUsers.slice(0, 4).map((p) => (
                    <div
                      key={p.userId}
                      title={`${p.name} (${p.role}) · ${p.tabCount} active tab(s)`}
                      className="w-6 h-6 rounded-full bg-slate-800 text-white border-2 border-white flex items-center justify-center text-[10px] font-bold"
                    >
                      {p.name
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setAiDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Bot className="w-3.5 h-3.5 text-blue-600" />
              <span>AI Assistant</span>
            </button>

            {activeBoard && columns.length > 0 && (
              <button
                type="button"
                onClick={() => setNewTaskModalColId(columns[0].id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Task</span>
              </button>
            )}
          </div>
        </header>

        {/* Feedback / Conflict Reconciliation Notice Banner */}
        {bannerNotice && (
          <div
            className={`px-6 py-2.5 text-xs font-medium flex items-center justify-between gap-4 border-b ${
              bannerNotice.tone === 'error'
                ? 'bg-red-50 text-red-800 border-red-200'
                : 'bg-blue-50 text-blue-900 border-blue-200'
            }`}
          >
            <span>{bannerNotice.text}</span>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="text-current opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Workspace Section */}
        <main className="flex-1 overflow-y-auto">
          {activeSection === 'kanban' && (
            <KanbanWorkspace
              board={activeBoard}
              columns={columns}
              tasks={tasks}
              role={tenantRole}
              loading={loadingBoard}
              onSelectTask={(task) => setSelectedTask(task)}
              onOpenNewTaskModal={(colId) => setNewTaskModalColId(colId || columns[0]?.id || null)}
              onMoveTask={handleMoveTask}
              onCreateColumn={handleCreateColumn}
              onDeleteColumn={handleDeleteColumn}
            />
          )}

          {activeSection === 'activity' && (
            <ActivityAuditView tenant={activeTenant} logs={activityLogs} />
          )}

          {activeSection === 'team' && (
            <TeamRbacView
              tenant={activeTenant}
              currentUser={user}
              role={tenantRole}
              members={members}
              directoryUsers={directoryUsers}
              onMembersUpdated={async () => {
                if (!activeTenantId) return;
                const res = await apiRequest<{ members: TenantMember[]; directoryUsers: User[] }>(
                  `/api/memberships?tenantId=${activeTenantId}`
                );
                setMembers(res.members || []);
                setDirectoryUsers(res.directoryUsers || []);
              }}
            />
          )}

          {activeSection === 'lab' && (
            <SecurityConcurrencyLab
              user={user}
              organization={activeOrganization}
              tenant={activeTenant}
              role={tenantRole}
              tasks={tasks}
              socket={socketRef.current}
              onRefreshBoard={async () => {
                if (activeBoardId) {
                  await fetchActiveBoardDetail(activeBoardId);
                }
              }}
            />
          )}

          {activeSection === 'docs' && <DocsPortal />}
        </main>
      </div>

      {/* Task Details & Conflict Resolution Slide-Over */}
      <TaskDetailPanel
        task={selectedTask}
        columns={columns}
        members={members}
        onClose={() => setSelectedTask(null)}
        onTaskSaved={(updated) => {
          setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          setSelectedTask(updated);
        }}
        onTaskDeleted={(taskId) => {
          setTasks((prev) => prev.filter((t) => t.id !== taskId));
          setSelectedTask(null);
        }}
      />

      {/* Agentic AI Kanban Assistant Slide-Over */}
      <AiAssistantDrawer
        open={aiDrawerOpen}
        tenant={activeTenant}
        board={activeBoard}
        onClose={() => setAiDrawerOpen(false)}
      />

      {/* Create Task Modal */}
      {newTaskModalColId && activeBoard && (
        <NewTaskModal
          board={activeBoard}
          columns={columns}
          defaultColumnId={newTaskModalColId}
          members={members}
          onClose={() => setNewTaskModalColId(null)}
          onCreated={(created) => {
            setTasks((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
            setNewTaskModalColId(null);
          }}
        />
      )}

      {/* Create Board Modal */}
      {newBoardModalOpen && activeTenant && (
        <SimpleCreateModal
          title={`Create Board in ${activeTenant.name}`}
          label="Board Name"
          placeholder="e.g. Q4 Enterprise Release"
          secondaryLabel="Board Description"
          onClose={() => setNewBoardModalOpen(false)}
          onSubmit={async (name, description) => {
            const res = await apiRequest<{ board: Board }>('/api/boards', {
              method: 'POST',
              body: JSON.stringify({ tenantId: activeTenant.id, name, description }),
            });
            setBoards((prev) => (prev.some((b) => b.id === res.board.id) ? prev : [...prev, res.board]));
            setActiveBoardId(res.board.id);
            setActiveSection('kanban');
            setNewBoardModalOpen(false);
          }}
        />
      )}

      {/* Create Branch Tenant Modal */}
      {newBranchModalOpen && activeOrganization && (
        <SimpleCreateModal
          title={`Add Branch Tenant to ${activeOrganization.name}`}
          label="Branch / City Name"
          placeholder="e.g. Delhi NCR"
          onClose={() => setNewBranchModalOpen(false)}
          onSubmit={async (name) => {
            const res = await apiRequest<{ tenant: Tenant }>('/api/tenants', {
              method: 'POST',
              body: JSON.stringify({ organizationId: activeOrganization.id, name }),
            });
            const me = await apiRequest<{ organizations: Organization[] }>('/api/auth/me');
            setOrganizations(me.organizations || []);
            setActiveTenantId(res.tenant.id);
            setNewBranchModalOpen(false);
          }}
        />
      )}

      {/* Create Organization Modal */}
      {newOrgModalOpen && (
        <SimpleCreateModal
          title="Provision New Parent Organization"
          label="Organization Name"
          placeholder="e.g. Horizon FinTech"
          secondaryLabel="Initial Branch Name (e.g. Bengaluru)"
          onClose={() => setNewOrgModalOpen(false)}
          onSubmit={async (name, initialTenantName) => {
            const res = await apiRequest<{
              organizationId: string;
              tenantId: string;
              organizations: Organization[];
            }>('/api/organizations', {
              method: 'POST',
              body: JSON.stringify({ name, initialTenantName: initialTenantName || 'Headquarters' }),
            });
            setOrganizations(res.organizations || []);
            setActiveOrgId(res.organizationId);
            setActiveTenantId(res.tenantId);
            setNewOrgModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Focused Modal Sub-Components
// ============================================================================

function NewTaskModal({
  board,
  columns,
  defaultColumnId,
  members,
  onClose,
  onCreated,
}: {
  board: Board;
  columns: BoardColumn[];
  defaultColumnId: string;
  members: TenantMember[];
  onClose: () => void;
  onCreated: (task: Task) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(defaultColumnId);
  const [priority, setPriority] = useState<PriorityType>('MEDIUM');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const labels = labelsText
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      const res = await apiRequest<{ task: Task }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          boardId: board.id,
          columnId,
          title,
          description,
          priority,
          assignedTo: assignedTo || null,
          dueDate: dueDate || null,
          labels,
        }),
      });
      onCreated(res.task);
    } catch (err: any) {
      setError(err?.message || 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Create Task in {board.name}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Task Title</label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Implement Webhook Signature Verification"
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Key technical details..."
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Column</label>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityType)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assignee</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Labels (comma separated)
            </label>
            <input
              type="text"
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              placeholder="API, Security"
              className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
            >
              {saving ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SimpleCreateModal({
  title,
  label,
  placeholder,
  secondaryLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder: string;
  secondaryLabel?: string;
  onClose: () => void;
  onSubmit: (primary: string, secondary: string) => Promise<void>;
}) {
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(primary.trim(), secondary.trim());
    } catch (err: any) {
      setError(err?.message || 'Operation failed.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
            <input
              type="text"
              required
              autoFocus
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder={placeholder}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {secondaryLabel && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {secondaryLabel}
              </label>
              <input
                type="text"
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
            >
              {saving ? 'Saving...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
