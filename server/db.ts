import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';

const dbPath = process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'kanban.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      tenant_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('ORG_ADMIN', 'TENANT_ADMIN', 'MEMBER')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assigned_to TEXT,
      priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
      due_date TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tenants_organization_id ON tenants(organization_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_tenant_id ON memberships(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_org_user ON memberships(organization_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_boards_tenant_id ON boards(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_columns_board_id ON columns(board_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_tenant_id ON tasks(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_column_id ON tasks(column_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_board_tenant ON tasks(board_id, tenant_id);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant_id ON activity_logs(tenant_id, created_at DESC);
  `);

  const countRow = db.prepare('SELECT COUNT(*) as count FROM organizations').get() as { count: number };
  if (countRow.count === 0) {
    seedDatabase();
  }
}

export function resetAndSeedDatabase(): void {
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM activity_logs;
      DELETE FROM tasks;
      DELETE FROM columns;
      DELETE FROM boards;
      DELETE FROM memberships;
      DELETE FROM tenants;
      DELETE FROM organizations;
      DELETE FROM users;
    `);
    seedDatabase();
  });
  tx();
}

export function seedDatabase(): void {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400 * 1000 * 2).toISOString();
  const nextWeek = new Date(Date.now() + 86400 * 1000 * 5).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400 * 1000 * 1).toISOString().slice(0, 10);
  const overdueDate = new Date(Date.now() - 86400 * 1000 * 3).toISOString().slice(0, 10);

  const passwordHash = bcrypt.hashSync('Password@123', 10);

  const insertOrg = db.prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
  const insertTenant = db.prepare('INSERT INTO tenants (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)');
  const insertUser = db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertMembership = db.prepare(
    'INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertBoard = db.prepare(
    'INSERT INTO boards (id, organization_id, tenant_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertColumn = db.prepare(
    'INSERT INTO columns (id, board_id, tenant_id, name, position) VALUES (?, ?, ?, ?, ?)'
  );
  const insertTask = db.prepare(
    `INSERT INTO tasks (
      id, board_id, column_id, tenant_id, title, description, assigned_to,
      priority, due_date, labels, position, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertActivity = db.prepare(
    `INSERT INTO activity_logs (
      id, tenant_id, user_id, entity_type, entity_id, action, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // 1. Organizations
  insertOrg.run('ORG001', 'ABC Technologies', yesterday, now);
  insertOrg.run('ORG002', 'XYZ Solutions', yesterday, now);

  // 2. Tenants (Branches)
  insertTenant.run('TEN001', 'ORG001', 'Hyderabad', yesterday);
  insertTenant.run('TEN002', 'ORG001', 'Bangalore', yesterday);
  insertTenant.run('TEN003', 'ORG001', 'Chennai', yesterday);
  insertTenant.run('TEN004', 'ORG002', 'Mumbai', yesterday);
  insertTenant.run('TEN005', 'ORG002', 'Pune', yesterday);

  // 3. Users (Password for all demo accounts: Password@123)
  insertUser.run('USR001', 'Rahul Sharma', 'rahul@abctech.in', passwordHash, yesterday);
  insertUser.run('USR002', 'Priya Nair', 'priya@abctech.in', passwordHash, yesterday);
  insertUser.run('USR003', 'Arjun Reddy', 'arjun@abctech.in', passwordHash, yesterday);
  insertUser.run('USR004', 'Sneha Rao', 'sneha@abctech.in', passwordHash, yesterday);
  insertUser.run('USR005', 'Vikram Iyer', 'vikram@abctech.in', passwordHash, yesterday);
  insertUser.run('USR006', 'Kiran Deshmukh', 'kiran@xyzsolutions.in', passwordHash, yesterday);

  // 4. Memberships (RBAC across Organizations & Tenants)
  // Rahul is Org Admin of ABC Technologies (org-wide + Hyderabad primary) and Member of XYZ Mumbai for multi-org testing
  insertMembership.run(crypto.randomUUID(), 'USR001', 'ORG001', null, 'ORG_ADMIN', yesterday);
  insertMembership.run(crypto.randomUUID(), 'USR001', 'ORG001', 'TEN001', 'ORG_ADMIN', yesterday);
  // Priya is Tenant Admin ONLY in ABC Hyderabad (cannot access Bangalore!)
  insertMembership.run(crypto.randomUUID(), 'USR002', 'ORG001', 'TEN001', 'TENANT_ADMIN', yesterday);
  // Arjun is Member ONLY in ABC Hyderabad (cannot access Bangalore or create boards/tenants!)
  insertMembership.run(crypto.randomUUID(), 'USR003', 'ORG001', 'TEN001', 'MEMBER', yesterday);
  // Sneha is Tenant Admin ONLY in ABC Bangalore (cannot access Hyderabad!)
  insertMembership.run(crypto.randomUUID(), 'USR004', 'ORG001', 'TEN002', 'TENANT_ADMIN', yesterday);
  // Vikram is Tenant Admin in ABC Chennai
  insertMembership.run(crypto.randomUUID(), 'USR005', 'ORG001', 'TEN003', 'TENANT_ADMIN', yesterday);
  // Kiran is Org Admin of XYZ Solutions (Mumbai & Pune)
  insertMembership.run(crypto.randomUUID(), 'USR006', 'ORG002', null, 'ORG_ADMIN', yesterday);
  insertMembership.run(crypto.randomUUID(), 'USR006', 'ORG002', 'TEN004', 'ORG_ADMIN', yesterday);

  // Helper to create a board with 4 standard columns
  function createBoardWithColumns(
    boardId: string,
    orgId: string,
    tenantId: string,
    name: string,
    description: string,
    creatorId: string
  ) {
    insertBoard.run(boardId, orgId, tenantId, name, description, creatorId, yesterday);
    const cols = [
      { id: `${boardId}_COL1`, name: 'To Do', pos: 1 },
      { id: `${boardId}_COL2`, name: 'In Progress', pos: 2 },
      { id: `${boardId}_COL3`, name: 'Testing', pos: 3 },
      { id: `${boardId}_COL4`, name: 'Done', pos: 4 },
    ];
    for (const c of cols) {
      insertColumn.run(c.id, boardId, tenantId, c.name, c.pos);
    }
    return cols;
  }

  // Hyderabad Boards
  createBoardWithColumns(
    'BRD_HYD_1',
    'ORG001',
    'TEN001',
    'Website Development',
    'Customer portal overhaul, SSO authentication, and tenant billing dashboard for Q4 launch.',
    'USR001'
  );
  createBoardWithColumns(
    'BRD_HYD_2',
    'ORG001',
    'TEN001',
    'Mobile Application Development',
    'iOS and Android offline sync client with push notifications and biometric sign-in.',
    'USR002'
  );

  // Bangalore Boards
  createBoardWithColumns(
    'BRD_BLR_1',
    'ORG001',
    'TEN002',
    'CRM Development',
    'Enterprise sales pipeline automation, lead scoring engine, and webhook connectors.',
    'USR004'
  );
  createBoardWithColumns(
    'BRD_BLR_2',
    'ORG001',
    'TEN002',
    'AI Automation',
    'Internal document triage and customer ticket classification pipelines.',
    'USR004'
  );

  // Chennai Board
  createBoardWithColumns(
    'BRD_CHE_1',
    'ORG001',
    'TEN003',
    'Cloud Infrastructure Migration',
    'Zero-downtime PostgreSQL cluster replication and multi-region failover readiness.',
    'USR005'
  );

  // XYZ Mumbai & Pune Boards
  createBoardWithColumns(
    'BRD_MUM_1',
    'ORG002',
    'TEN004',
    'Customer Support Platform',
    'Omnichannel SLA routing engine, live agent workspace, and escalation rules.',
    'USR006'
  );
  createBoardWithColumns(
    'BRD_PUN_1',
    'ORG002',
    'TEN005',
    'Financial Reconciliation Engine',
    'Automated daily settlement verification and GST invoice generation.',
    'USR006'
  );

  // Seed Hyderabad Tasks (Website Development)
  const hydTasks = [
    {
      id: 'TSK_HYD_01',
      col: 'BRD_HYD_1_COL1',
      title: 'Design Multi-Tenant Login & Workspace Selector',
      desc: 'Create responsive sign-in flow with organization dropdown and authorized branch switcher.',
      assignee: 'USR001',
      priority: 'HIGH',
      due: tomorrow,
      labels: ['Frontend', 'Auth'],
      pos: 1,
    },
    {
      id: 'TSK_HYD_02',
      col: 'BRD_HYD_1_COL1',
      title: 'Fix Zod Payload Validation on Task Endpoints',
      desc: 'Reject empty titles, cross-board column IDs, and unauthorized assignee UUIDs with HTTP 400.',
      assignee: 'USR003',
      priority: 'URGENT',
      due: overdueDate,
      labels: ['Backend', 'Security'],
      pos: 2,
    },
    {
      id: 'TSK_HYD_03',
      col: 'BRD_HYD_1_COL2',
      title: 'Develop Registration & JWT Middleware API',
      desc: 'Hash user passwords with bcrypt (cost 10) and issue stateless signed JWT access tokens.',
      assignee: 'USR003',
      priority: 'HIGH',
      due: tomorrow,
      labels: ['Backend', 'Auth'],
      pos: 1,
    },
    {
      id: 'TSK_HYD_04',
      col: 'BRD_HYD_1_COL2',
      title: 'Implement Optimistic Concurrency Version Check',
      desc: 'Verify expected task version inside ACID SQL transaction and return HTTP 409 on stale writes.',
      assignee: 'USR002',
      priority: 'URGENT',
      due: nextWeek,
      labels: ['Database', 'Concurrency'],
      pos: 2,
    },
    {
      id: 'TSK_HYD_05',
      col: 'BRD_HYD_1_COL3',
      title: 'Verify Cross-Tenant Socket.IO Room Isolation',
      desc: 'Ensure Hyderabad task mutations broadcast strictly to tenant:TEN001 and never leak to Bangalore.',
      assignee: 'USR002',
      priority: 'HIGH',
      due: overdueDate,
      labels: ['WebSockets', 'QA'],
      pos: 1,
    },
    {
      id: 'TSK_HYD_06',
      col: 'BRD_HYD_1_COL4',
      title: 'Provision Normalized 8-Table Relational Schema',
      desc: 'Deploy organizations, tenants, users, memberships, boards, columns, tasks, and activity_logs.',
      assignee: 'USR001',
      priority: 'MEDIUM',
      due: yesterday.slice(0, 10),
      labels: ['Database'],
      pos: 1,
    },
  ];

  for (const t of hydTasks) {
    insertTask.run(
      t.id,
      'BRD_HYD_1',
      t.col,
      'TEN001',
      t.title,
      t.desc,
      t.assignee,
      t.priority,
      t.due,
      JSON.stringify(t.labels),
      t.pos,
      1,
      yesterday,
      now
    );
  }

  // Hyderabad Board 2 Tasks
  insertTask.run(
    'TSK_HYD_07',
    'BRD_HYD_2',
    'BRD_HYD_2_COL1',
    'TEN001',
    'Implement Reconnection Queue for Offline Mobile Edits',
    'Reconcile local optimistic queue against authoritative board state after Socket.IO reconnect.',
    'USR003',
    'HIGH',
    nextWeek,
    JSON.stringify(['Mobile', 'Sync']),
    1,
    1,
    yesterday,
    now
  );
  insertTask.run(
    'TSK_HYD_08',
    'BRD_HYD_2',
    'BRD_HYD_2_COL2',
    'TEN001',
    'Configure Biometric Token Storage on Android Keystore',
    'Store short-lived JWT access tokens securely using hardware-backed encryption.',
    'USR002',
    'MEDIUM',
    nextWeek,
    JSON.stringify(['Security', 'Mobile']),
    1,
    1,
    yesterday,
    now
  );

  // Seed Bangalore Tasks (Private to Bangalore Tenant TEN002 + Org Admin)
  const blrTasks = [
    {
      id: 'TSK_BLR_01',
      col: 'BRD_BLR_1_COL1',
      title: 'Build Enterprise Lead Deduplication Pipeline',
      desc: 'Confidential Bangalore CRM roadmap item: normalize inbound enterprise leads across APAC.',
      assignee: 'USR004',
      priority: 'HIGH',
      due: tomorrow,
      labels: ['CRM', 'Data'],
      pos: 1,
    },
    {
      id: 'TSK_BLR_02',
      col: 'BRD_BLR_1_COL2',
      title: 'Integrate Webhook Retry Queue with Dead-Letter Alerts',
      desc: 'Guarantee at-least-once CRM event delivery with idempotency keys.',
      assignee: 'USR004',
      priority: 'URGENT',
      due: overdueDate,
      labels: ['Backend', 'Reliability'],
      pos: 1,
    },
    {
      id: 'TSK_BLR_03',
      col: 'BRD_BLR_1_COL4',
      title: 'Audit Tenant-Scoped Composite PostgreSQL Indexes',
      desc: 'Benchmark query latency on (tenant_id, column_id, position) across 100k CRM tasks.',
      assignee: 'USR004',
      priority: 'MEDIUM',
      due: yesterday.slice(0, 10),
      labels: ['Database'],
      pos: 1,
    },
  ];

  for (const t of blrTasks) {
    insertTask.run(
      t.id,
      'BRD_BLR_1',
      t.col,
      'TEN002',
      t.title,
      t.desc,
      t.assignee,
      t.priority,
      t.due,
      JSON.stringify(t.labels),
      t.pos,
      1,
      yesterday,
      now
    );
  }

  // Chennai Tasks
  insertTask.run(
    'TSK_CHE_01',
    'BRD_CHE_1',
    'BRD_CHE_1_COL2',
    'TEN003',
    'Enable PostgreSQL Row-Level Security Policies',
    'Enforce app.current_tenant_id session setting as defense-in-depth alongside Express middleware.',
    'USR005',
    'HIGH',
    nextWeek,
    JSON.stringify(['PostgreSQL', 'Security']),
    1,
    1,
    yesterday,
    now
  );

  // XYZ Mumbai Tasks (Completely separate Organization ORG002)
  insertTask.run(
    'TSK_MUM_01',
    'BRD_MUM_1',
    'BRD_MUM_1_COL1',
    'TEN004',
    'Configure Omnichannel SLA Escalation Matrix',
    'Automatically escalate P0 enterprise tickets breaching 15-minute first-response SLA.',
    'USR006',
    'URGENT',
    tomorrow,
    JSON.stringify(['SLA', 'Support']),
    1,
    1,
    yesterday,
    now
  );
  insertTask.run(
    'TSK_MUM_02',
    'BRD_MUM_1',
    'BRD_MUM_1_COL3',
    'TEN004',
    'Load Test 500 Concurrent Agent WebSocket Sessions',
    'Validate multi-tab presence heartbeats and memory footprint under sustained ticket updates.',
    'USR006',
    'HIGH',
    nextWeek,
    JSON.stringify(['WebSockets', 'Performance']),
    1,
    1,
    yesterday,
    now
  );

  // Seed initial activity logs
  insertActivity.run(
    crypto.randomUUID(),
    'TEN001',
    'USR001',
    'board',
    'BRD_HYD_1',
    'Created',
    JSON.stringify({ boardName: 'Website Development', branch: 'Hyderabad' }),
    yesterday
  );
  insertActivity.run(
    crypto.randomUUID(),
    'TEN001',
    'USR002',
    'task',
    'TSK_HYD_04',
    'Moved',
    JSON.stringify({ title: 'Implement Optimistic Concurrency Version Check', from: 'To Do', to: 'In Progress' }),
    now
  );
  insertActivity.run(
    crypto.randomUUID(),
    'TEN001',
    'USR003',
    'task',
    'TSK_HYD_03',
    'Updated',
    JSON.stringify({ title: 'Develop Registration & JWT Middleware API', version: 1 }),
    now
  );
  insertActivity.run(
    crypto.randomUUID(),
    'TEN002',
    'USR004',
    'task',
    'TSK_BLR_02',
    'Created',
    JSON.stringify({ title: 'Integrate Webhook Retry Queue with Dead-Letter Alerts', branch: 'Bangalore' }),
    now
  );
}
