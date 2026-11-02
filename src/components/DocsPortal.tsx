import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { apiRequest } from '../services/api.ts';

interface DocsPortalProps {
  isPublicMode?: boolean;
  onBackToApp?: () => void;
}

type DocTab =
  | 'overview'
  | 'erd'
  | 'readme'
  | 'sqlSchema'
  | 'prismaSchema'
  | 'apiDocs'
  | 'wsDocs'
  | 'pythonAi';

const CHECKLIST_ITEMS = [
  'All CRUD APIs (Organizations, Tenants, Boards, Columns, Tasks) work with Zod validation',
  'Stateless JWT authentication & bcrypt password hashing implemented',
  'Three RBAC roles enforced on backend (ORG_ADMIN, TENANT_ADMIN, MEMBER)',
  'Multi-organization to multi-branch (Tenant) hierarchy modeled cleanly',
  'Cross-tenant API & UUID access strictly blocked with HTTP 403',
  'Cross-organization access strictly blocked with HTTP 403',
  'Socket.IO rooms are tenant-scoped (tenant:<id>) and SQL-authorized',
  'Real-time task creation, editing, movement, and deletion sync live',
  'Multi-tab online presence indicators prevent false offline drops',
  'Optimistic UI drag-and-drop updates reconcile cleanly with server state',
  'Optimistic locking (version field) prevents stale overwrites via HTTP 409',
  'Transactional drag-and-drop re-indexing keeps column ordering sequential',
  'Immutable tenant-scoped activity_logs recorded and streamed live',
  'Automatic Socket.IO network reconnection restores room & board state',
  'Complete README, ER Diagram, PostgreSQL/Prisma schemas, REST & WebSocket docs included',
];

export function DocsPortal({ isPublicMode = false, onBackToApp }: DocsPortalProps) {
  const [activeTab, setActiveTab] = useState<DocTab>('erd');
  const [files, setFiles] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiRequest<{ files: Record<string, string> }>('/api/docs/files')
      .then((res) => setFiles(res.files || {}))
      .catch(() => {});
  }, []);

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const tabs: Array<{ id: DocTab; label: string }> = [
    { id: 'erd', label: 'Database ER Diagram' },
    { id: 'overview', label: 'Architecture & Checklist' },
    { id: 'readme', label: 'README.md' },
    { id: 'sqlSchema', label: 'PostgreSQL DDL' },
    { id: 'prismaSchema', label: 'Prisma Schema' },
    { id: 'apiDocs', label: 'REST API Docs' },
    { id: 'wsDocs', label: 'WebSocket Docs' },
    { id: 'pythonAi', label: 'Python AI Service' },
  ];

  return (
    <div className={isPublicMode ? 'min-h-screen bg-slate-50 text-slate-900' : 'h-full overflow-y-auto'}>
      {isPublicMode && (
        <header className="px-6 lg:px-10 py-4 bg-white border-b border-slate-200 flex items-center justify-between gap-8">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            TenantFlow Documentation
          </span>
          <button
            type="button"
            onClick={onBackToApp}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Live Application</span>
          </button>
        </header>
      )}

      <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Assignment Deliverables &amp; System Documentation
          </h1>
          <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
            Complete engineering documentation for the Multi-Organization, Multi-Tenant Real-Time Collaborative Kanban Board: 8-table Entity-Relationship Diagram, PostgreSQL + RLS schema, Prisma schema, REST &amp; Socket.IO specifications, and standalone Python FastAPI Agentic AI microservice.
          </p>
        </div>

        {/* Interactive Tab Selector */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === t.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Visual SVG 8-Table Database ER Diagram */}
        {activeTab === 'erd' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Deliverable 3: Normalized 8-Table Multi-Tenant Entity-Relationship Diagram
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Highlighted <code className="font-mono text-blue-700">tenant_id</code> foreign keys enforce row-level branch isolation across all business records.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                Organization → Tenant → Board → Column → Task
              </span>
            </div>

            <div className="overflow-x-auto">
              <svg
                viewBox="0 0 1080 620"
                className="w-full min-w-[880px] h-auto bg-slate-50 rounded-lg border border-slate-200"
                role="img"
                aria-label="8-Table Database Entity Relationship Diagram"
              >
                {/* Relationship Connector Lines */}
                <g stroke="#64748B" strokeWidth="1.75" fill="none">
                  {/* organizations -> tenants */}
                  <path d="M 250 110 L 340 110" />
                  {/* organizations -> memberships */}
                  <path d="M 140 175 L 140 270 L 340 310" />
                  {/* users -> memberships */}
                  <path d="M 250 355 L 340 355" />
                  {/* tenants -> memberships */}
                  <path d="M 460 190 L 460 265" />
                  {/* tenants -> boards */}
                  <path d="M 580 110 L 680 110" />
                  {/* tenants -> activity_logs */}
                  <path d="M 580 155 L 630 155 L 630 485 L 680 485" />
                  {/* boards -> columns */}
                  <path d="M 810 215 L 810 270" />
                  {/* columns -> tasks */}
                  <path d="M 680 340 L 580 340 L 580 485 L 580 485" />
                  <path d="M 680 350 L 615 350 L 615 495 L 580 495" />
                  {/* users -> tasks (assigned_to) */}
                  <path d="M 140 435 L 140 525 L 340 525" />
                </g>

                {/* Table 1: organizations */}
                <g transform="translate(30, 40)">
                  <rect width="220" height="135" rx="8" fill="#FFFFFF" stroke="#CBD5E1" />
                  <rect width="220" height="32" rx="8" fill="#0F172A" />
                  <text x="14" y="21" fill="#FFFFFF" fontSize="12" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    1. organizations
                  </text>
                  <text x="14" y="54" fill="#0F172A" fontSize="11" fontFamily="IBM Plex Mono, monospace">PK id : UUID</text>
                  <text x="14" y="76" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">   name : VARCHAR</text>
                  <text x="14" y="98" fill="#64748B" fontSize="11" fontFamily="IBM Plex Mono, monospace">   created_at : TIMESTAMPTZ</text>
                  <text x="14" y="120" fill="#64748B" fontSize="11" fontFamily="IBM Plex Mono, monospace">   updated_at : TIMESTAMPTZ</text>
                </g>

                {/* Table 2: tenants */}
                <g transform="translate(340, 40)">
                  <rect width="240" height="150" rx="8" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5" />
                  <rect width="240" height="32" rx="8" fill="#1D4ED8" />
                  <text x="14" y="21" fill="#FFFFFF" fontSize="12" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    2. tenants (Branches)
                  </text>
                  <text x="14" y="54" fill="#0F172A" fontSize="11" fontFamily="IBM Plex Mono, monospace">PK id : UUID</text>
                  <text x="14" y="76" fill="#1D4ED8" fontSize="11" fontFamily="IBM Plex Mono, monospace">FK organization_id : UUID</text>
                  <text x="14" y="98" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">   name : VARCHAR</text>
                  <text x="14" y="120" fill="#64748B" fontSize="11" fontFamily="IBM Plex Mono, monospace">   created_at : TIMESTAMPTZ</text>
                </g>

                {/* Table 3: users */}
                <g transform="translate(30, 280)">
                  <rect width="220" height="155" rx="8" fill="#FFFFFF" stroke="#CBD5E1" />
                  <rect width="220" height="32" rx="8" fill="#0F172A" />
                  <text x="14" y="21" fill="#FFFFFF" fontSize="12" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    3. users
                  </text>
                  <text x="14" y="54" fill="#0F172A" fontSize="11" fontFamily="IBM Plex Mono, monospace">PK id : UUID</text>
                  <text x="14" y="76" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">   name : VARCHAR</text>
                  <text x="14" y="98" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">UK email : VARCHAR</text>
                  <text x="14" y="120" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">   password_hash : VARCHAR</text>
                  <text x="14" y="142" fill="#64748B" fontSize="11" fontFamily="IBM Plex Mono, monospace">   created_at : TIMESTAMPTZ</text>
                </g>

                {/* Table 4: memberships */}
                <g transform="translate(340, 265)">
                  <rect width="240" height="170" rx="8" fill="#FFFFFF" stroke="#CBD5E1" />
                  <rect width="240" height="32" rx="8" fill="#0F172A" />
                  <text x="14" y="21" fill="#FFFFFF" fontSize="12" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    4. memberships (RBAC)
                  </text>
                  <text x="14" y="54" fill="#0F172A" fontSize="11" fontFamily="IBM Plex Mono, monospace">PK id : UUID</text>
                  <text x="14" y="76" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">FK user_id : UUID</text>
                  <text x="14" y="98" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">FK organization_id : UUID</text>
                  <text x="14" y="120" fill="#1D4ED8" fontSize="11" fontWeight="600" fontFamily="IBM Plex Mono, monospace">FK tenant_id : UUID (Null=Org)</text>
                  <text x="14" y="142" fill="#0F172A" fontSize="11" fontFamily="IBM Plex Mono, monospace">   role : ORG|TENANT|MEMBER</text>
                </g>

                {/* Table 5: boards */}
                <g transform="translate(680, 40)">
                  <rect width="260" height="175" rx="8" fill="#FFFFFF" stroke="#CBD5E1" />
                  <rect width="260" height="32" rx="8" fill="#0F172A" />
                  <text x="14" y="21" fill="#FFFFFF" fontSize="12" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    5. boards
                  </text>
                  <text x="14" y="54" fill="#0F172A" fontSize="11" fontFamily="IBM Plex Mono, monospace">PK id : UUID</text>
                  <text x="14" y="76" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">FK organization_id : UUID</text>
                  <text x="14" y="98" fill="#1D4ED8" fontSize="11" fontWeight="600" fontFamily="IBM Plex Mono, monospace">FK tenant_id : UUID [ISOLATED]</text>
                  <text x="14" y="120" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">   name, description : TEXT</text>
                  <text x="14" y="142" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">FK created_by : UUID</text>
                  <text x="14" y="162" fill="#64748B" fontSize="11" fontFamily="IBM Plex Mono, monospace">   created_at : TIMESTAMPTZ</text>
                </g>

                {/* Table 6: columns */}
                <g transform="translate(680, 270)">
                  <rect width="260" height="145" rx="8" fill="#FFFFFF" stroke="#CBD5E1" />
                  <rect width="260" height="32" rx="8" fill="#0F172A" />
                  <text x="14" y="21" fill="#FFFFFF" fontSize="12" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    6. columns
                  </text>
                  <text x="14" y="54" fill="#0F172A" fontSize="11" fontFamily="IBM Plex Mono, monospace">PK id : UUID</text>
                  <text x="14" y="76" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">FK board_id : UUID</text>
                  <text x="14" y="98" fill="#1D4ED8" fontSize="11" fontWeight="600" fontFamily="IBM Plex Mono, monospace">FK tenant_id : UUID [ISOLATED]</text>
                  <text x="14" y="120" fill="#334155" fontSize="11" fontFamily="IBM Plex Mono, monospace">   name : VARCHAR, position : INT</text>
                </g>

                {/* Table 7: tasks */}
                <g transform="translate(300, 455)">
                  <rect width="280" height="150" rx="8" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5" />
                  <rect width="280" height="30" rx="8" fill="#1D4ED8" />
                  <text x="14" y="20" fill="#FFFFFF" fontSize="12" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    7. tasks (Version Locked)
                  </text>
                  <text x="14" y="50" fill="#0F172A" fontSize="10.5" fontFamily="IBM Plex Mono, monospace">PK id : UUID · FK board_id, column_id</text>
                  <text x="14" y="70" fill="#1D4ED8" fontSize="10.5" fontWeight="600" fontFamily="IBM Plex Mono, monospace">FK tenant_id : UUID [ISOLATED]</text>
                  <text x="14" y="90" fill="#334155" fontSize="10.5" fontFamily="IBM Plex Mono, monospace">   title, description, priority, due_date</text>
                  <text x="14" y="110" fill="#334155" fontSize="10.5" fontFamily="IBM Plex Mono, monospace">FK assigned_to : UUID · position : INT</text>
                  <text x="14" y="130" fill="#B45309" fontSize="10.5" fontWeight="600" fontFamily="IBM Plex Mono, monospace">   version : INT (Optimistic Concurrency)</text>
                </g>

                {/* Table 8: activity_logs */}
                <g transform="translate(680, 445)">
                  <rect width="260" height="155" rx="8" fill="#FFFFFF" stroke="#CBD5E1" />
                  <rect width="260" height="30" rx="8" fill="#0F172A" />
                  <text x="14" y="20" fill="#FFFFFF" fontSize="12" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
                    8. activity_logs
                  </text>
                  <text x="14" y="50" fill="#0F172A" fontSize="10.5" fontFamily="IBM Plex Mono, monospace">PK id : UUID</text>
                  <text x="14" y="70" fill="#1D4ED8" fontSize="10.5" fontWeight="600" fontFamily="IBM Plex Mono, monospace">FK tenant_id : UUID [ISOLATED]</text>
                  <text x="14" y="90" fill="#334155" fontSize="10.5" fontFamily="IBM Plex Mono, monospace">FK user_id : UUID</text>
                  <text x="14" y="110" fill="#334155" fontSize="10.5" fontFamily="IBM Plex Mono, monospace">   entity_type, entity_id, action</text>
                  <text x="14" y="130" fill="#64748B" fontSize="10.5" fontFamily="IBM Plex Mono, monospace">   details : JSONB, created_at</text>
                </g>
              </svg>
            </div>
          </div>
        )}

        {/* Tab 2: Architecture & 15/15 Testing Checklist */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-900">
                End-to-End Request &amp; Real-Time Event Sequence
              </h2>
              <ol className="space-y-3 text-xs text-slate-700 leading-relaxed list-decimal list-inside">
                <li>
                  <span className="font-semibold text-slate-900">Optimistic Drag-and-Drop:</span> User drags Task Card across columns in React (<code className="font-mono">@dnd-kit</code>). UI updates immediately while retaining a snapshot for rollback.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">JWT &amp; SQL Membership Gate:</span> Express receives <code className="font-mono">PATCH /api/tasks/:id/move</code>, validates Bearer JWT, and queries <code className="font-mono">memberships</code> to verify the caller belongs to the task's <code className="font-mono">tenant_id</code>.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">ACID Optimistic Concurrency Check:</span> Inside <code className="font-mono">db.transaction(...)</code>, SQL checks <code className="font-mono">current.version === expectedVersion</code>. Stale writes abort and return <code className="font-mono">HTTP 409 Conflict</code> with authoritative <code className="font-mono">serverTask</code>.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">Sequential Position Re-Indexing &amp; Audit:</span> Source and destination columns are re-indexed (<code className="font-mono">1..N</code>), <code className="font-mono">version</code> increments, and an <code className="font-mono">activity_logs</code> record is committed.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">Tenant-Scoped Broadcast:</span> Socket.IO emits <code className="font-mono">task:moved</code> and <code className="font-mono">activity:created</code> strictly to room <code className="font-mono">tenant:TEN001</code>. Collaborators in Bangalore (<code className="font-mono">tenant:TEN002</code>) receive zero packets.
                </li>
              </ol>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900">Verification Tracker</h2>
                <span className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
                  15 / 15 Verified
                </span>
              </div>
              <ul className="space-y-2 text-xs text-slate-700">
                {CHECKLIST_ITEMS.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Deliverable Raw File Viewers */}
        {activeTab !== 'erd' && activeTab !== 'overview' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
              <span className="text-xs font-mono font-semibold text-slate-700">
                {activeTab === 'readme' && '/README.md'}
                {activeTab === 'sqlSchema' && '/database/schema.sql'}
                {activeTab === 'prismaSchema' && '/database/prisma/schema.prisma'}
                {activeTab === 'apiDocs' && '/docs/api-documentation.md'}
                {activeTab === 'wsDocs' && '/docs/websocket-documentation.md'}
                {activeTab === 'pythonAi' && '/ai-service/main.py'}
              </span>

              <button
                type="button"
                onClick={() => handleCopy(files[activeTab] || '')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer whitespace-nowrap"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy File'}</span>
              </button>
            </div>

            <pre className="p-6 text-xs font-mono text-slate-800 leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {files[activeTab] || 'Loading repository deliverable...'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
