import { Router } from 'express';
import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { db, resetAndSeedDatabase } from './db.ts';
import {
  authenticateMiddleware,
  hasMinimumRole,
  resolveOrganizationAccess,
  resolveTenantAccess,
  signToken,
} from './auth.ts';
import type { AuthenticatedRequest, RoleType } from './auth.ts';
import { emitToTenant, getTenantOnlinePresence } from './socket.ts';
import { runTenantKanbanAgent } from './ai.ts';

export const apiRouter = Router();

function recordActivity(params: {
  tenantId: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  details: Record<string, unknown>;
}) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO activity_logs (id, tenant_id, user_id, entity_type, entity_id, action, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.tenantId,
    params.userId,
    params.entityType,
    params.entityId,
    params.action,
    JSON.stringify(params.details),
    createdAt
  );

  const userRow = db.prepare('SELECT name, email FROM users WHERE id = ?').get(params.userId) as
    | { name: string; email: string }
    | undefined;

  const logPayload = {
    id,
    tenant_id: params.tenantId,
    user_id: params.userId,
    user_name: userRow?.name || 'User',
    user_email: userRow?.email || '',
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    details: params.details,
    created_at: createdAt,
  };

  emitToTenant(params.tenantId, 'activity:created', logPayload);
  return logPayload;
}

function hydrateTask(taskId: string, tenantId: string) {
  const row = db
    .prepare(
      `SELECT t.*, u.name as assignee_name, u.email as assignee_email, c.name as column_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       JOIN columns c ON c.id = t.column_id
       WHERE t.id = ? AND t.tenant_id = ?`
    )
    .get(taskId, tenantId) as any;

  if (!row) return null;
  return {
    ...row,
    labels: (() => {
      try {
        return JSON.parse(row.labels || '[]');
      } catch {
        return [];
      }
    })(),
  };
}

function buildUserContext(userId: string) {
  const memberships = db
    .prepare(
      `SELECT m.id, m.organization_id, m.tenant_id, m.role, m.created_at,
              o.name as organization_name, t.name as tenant_name
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       LEFT JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = ?`
    )
    .all(userId) as Array<{
    id: string;
    organization_id: string;
    tenant_id: string | null;
    role: RoleType;
    organization_name: string;
    tenant_name: string | null;
  }>;

  // Authorized organizations
  const orgIds = Array.from(new Set(memberships.map((m) => m.organization_id)));
  const organizations = orgIds.map((orgId) => {
    const orgRow = db.prepare('SELECT id, name, created_at, updated_at FROM organizations WHERE id = ?').get(orgId) as any;
    const access = resolveOrganizationAccess(userId, orgId)!;

    // If ORG_ADMIN, user has access to ALL tenants in this organization; otherwise only tenants with explicit membership
    let tenants: any[] = [];
    if (access.isOrgAdmin) {
      tenants = db
        .prepare('SELECT id, organization_id, name, created_at FROM tenants WHERE organization_id = ? ORDER BY name ASC')
        .all(orgId)
        .map((t: any) => ({ ...t, role: 'ORG_ADMIN' as RoleType }));
    } else {
      const explicitTenantIds = memberships
        .filter((m) => m.organization_id === orgId && m.tenant_id)
        .map((m) => m.tenant_id as string);
      if (explicitTenantIds.length > 0) {
        const placeholders = explicitTenantIds.map(() => '?').join(',');
        const rawTenants = db
          .prepare(
            `SELECT id, organization_id, name, created_at FROM tenants WHERE id IN (${placeholders}) ORDER BY name ASC`
          )
          .all(...explicitTenantIds) as any[];
        tenants = rawTenants.map((t) => {
          const resolved = resolveTenantAccess(userId, t.id);
          return { ...t, role: resolved?.role || 'MEMBER' };
        });
      }
    }

    return {
      ...orgRow,
      highestRole: access.highestRole,
      isOrgAdmin: access.isOrgAdmin,
      tenants,
    };
  });

  return { memberships, organizations };
}

// ============================================================================
// Health & Demo Helpers
// ============================================================================

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'TenantFlow Multi-Tenant Real-Time Server',
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/demo/accounts', (_req, res) => {
  const accounts = [
    {
      name: 'Rahul Sharma',
      email: 'rahul@abctech.in',
      password: 'Password@123',
      organization: 'ABC Technologies',
      branch: 'All Branches (Hyderabad, Bangalore, Chennai)',
      role: 'ORG_ADMIN',
      summary: 'Full organization and multi-branch administration across ABC Technologies',
    },
    {
      name: 'Priya Nair',
      email: 'priya@abctech.in',
      password: 'Password@123',
      organization: 'ABC Technologies',
      branch: 'Hyderabad only',
      role: 'TENANT_ADMIN',
      summary: 'Manages boards, columns, and members strictly within Hyderabad branch',
    },
    {
      name: 'Arjun Reddy',
      email: 'arjun@abctech.in',
      password: 'Password@123',
      organization: 'ABC Technologies',
      branch: 'Hyderabad only',
      role: 'MEMBER',
      summary: 'Creates, edits, and moves tasks in Hyderabad; blocked from admin & Bangalore',
    },
    {
      name: 'Sneha Rao',
      email: 'sneha@abctech.in',
      password: 'Password@123',
      organization: 'ABC Technologies',
      branch: 'Bangalore only',
      role: 'TENANT_ADMIN',
      summary: 'Isolated to Bangalore CRM & AI boards; zero visibility into Hyderabad',
    },
    {
      name: 'Kiran Deshmukh',
      email: 'kiran@xyzsolutions.in',
      password: 'Password@123',
      organization: 'XYZ Solutions',
      branch: 'Mumbai & Pune',
      role: 'ORG_ADMIN',
      summary: 'Separate parent organization (XYZ Solutions); completely isolated from ABC Tech',
    },
  ];
  res.json({ accounts });
});

apiRouter.post('/demo/reset', authenticateMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  resetAndSeedDatabase();
  res.status(200).json({ message: 'Database reset to clean multi-tenant seed data.' });
});

// ============================================================================
// Authentication APIs
// ============================================================================

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.'),
  email: z.string().trim().email('Valid email address required.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  organizationName: z.string().trim().min(2).optional(),
  branchName: z.string().trim().min(2).optional(),
});

apiRouter.post('/auth/register', (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration payload.' });
    return;
  }

  const { name, email, password, organizationName, branchName } = parsed.data;
  const lowerEmail = email.toLowerCase();

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(lowerEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      name,
      lowerEmail,
      passwordHash,
      now
    );

    if (organizationName) {
      const orgId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const firstBranch = branchName || 'Headquarters';
      db.prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        orgId,
        organizationName,
        now,
        now
      );
      db.prepare('INSERT INTO tenants (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)').run(
        tenantId,
        orgId,
        firstBranch,
        now
      );
      db.prepare(
        'INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), userId, orgId, null, 'ORG_ADMIN', now);

      const boardId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO boards (id, organization_id, tenant_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(boardId, orgId, tenantId, 'Core Sprint Board', `Primary workspace board for ${firstBranch}`, userId, now);

      const defaultCols = ['To Do', 'In Progress', 'Testing', 'Done'];
      defaultCols.forEach((colName, index) => {
        db.prepare('INSERT INTO columns (id, board_id, tenant_id, name, position) VALUES (?, ?, ?, ?, ?)').run(
          crypto.randomUUID(),
          boardId,
          tenantId,
          colName,
          index + 1
        );
      });
    } else {
      // Default demo onboarding: grant MEMBER access to ABC Technologies -> Hyderabad so new signups can collaborate immediately
      db.prepare(
        'INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), userId, 'ORG001', 'TEN001', 'MEMBER', now);
    }
  });

  tx();

  const user = { id: userId, name, email: lowerEmail };
  const token = signToken(user);
  const context = buildUserContext(userId);

  res.status(201).json({ token, user, ...context });
});

const loginSchema = z.object({
  email: z.string().trim().email('Valid email required.'),
  password: z.string().min(1, 'Password is required.'),
});

apiRouter.post('/auth/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid login input.' });
    return;
  }

  const lowerEmail = parsed.data.email.toLowerCase();
  const row = db
    .prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?')
    .get(lowerEmail) as { id: string; name: string; email: string; password_hash: string } | undefined;

  if (!row || !bcrypt.compareSync(parsed.data.password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const user = { id: row.id, name: row.name, email: row.email };
  const token = signToken(user);
  const context = buildUserContext(user.id);

  res.status(200).json({ token, user, ...context });
});

apiRouter.get('/auth/me', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const context = buildUserContext(user.id);
  res.status(200).json({ user, ...context });
});

// ============================================================================
// Organization CRUD APIs
// ============================================================================

apiRouter.get('/organizations', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const context = buildUserContext(req.user!.id);
  res.status(200).json({ organizations: context.organizations });
});

apiRouter.get('/organizations/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const orgId = req.params.id;
  const access = resolveOrganizationAccess(req.user!.id, orgId);
  if (!access) {
    res.status(403).json({ error: '403 Forbidden: You do not have membership in this organization.' });
    return;
  }
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
  if (!org) {
    res.status(404).json({ error: 'Organization not found.' });
    return;
  }
  res.status(200).json({ organization: org, access });
});

apiRouter.post('/organizations', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({
    name: z.string().trim().min(2, 'Organization name is required.'),
    initialTenantName: z.string().trim().min(2).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
    return;
  }

  const now = new Date().toISOString();
  const orgId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const branchName = parsed.data.initialTenantName || 'Headquarters';

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      orgId,
      parsed.data.name,
      now,
      now
    );
    db.prepare('INSERT INTO tenants (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)').run(
      tenantId,
      orgId,
      branchName,
      now
    );
    db.prepare(
      'INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), req.user!.id, orgId, null, 'ORG_ADMIN', now);

    const boardId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO boards (id, organization_id, tenant_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(boardId, orgId, tenantId, `${branchName} Delivery Board`, 'Initial project board', req.user!.id, now);

    ['To Do', 'In Progress', 'Testing', 'Done'].forEach((col, i) => {
      db.prepare('INSERT INTO columns (id, board_id, tenant_id, name, position) VALUES (?, ?, ?, ?, ?)').run(
        crypto.randomUUID(),
        boardId,
        tenantId,
        col,
        i + 1
      );
    });
  });
  tx();

  const context = buildUserContext(req.user!.id);
  res.status(201).json({
    organizationId: orgId,
    tenantId,
    organizations: context.organizations,
  });
});

apiRouter.put('/organizations/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const orgId = req.params.id;
  const access = resolveOrganizationAccess(req.user!.id, orgId);
  if (!access || !access.isOrgAdmin) {
    res.status(403).json({ error: '403 Forbidden: Only Org Admins can update organization settings.' });
    return;
  }
  const schema = z.object({ name: z.string().trim().min(2) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid organization name required.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?').run(parsed.data.name, now, orgId);
  const updated = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
  res.status(200).json({ organization: updated });
});

apiRouter.delete('/organizations/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const orgId = req.params.id;
  const access = resolveOrganizationAccess(req.user!.id, orgId);
  if (!access || !access.isOrgAdmin) {
    res.status(403).json({ error: '403 Forbidden: Only Org Admins can delete an organization.' });
    return;
  }
  db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);
  res.status(200).json({ deleted: true, id: orgId });
});

// ============================================================================
// Tenant (Branch) CRUD APIs
// ============================================================================

apiRouter.get('/tenants', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const organizationId = req.query.organizationId as string | undefined;
  const context = buildUserContext(req.user!.id);
  if (organizationId) {
    const org = context.organizations.find((o) => o.id === organizationId);
    if (!org) {
      res.status(403).json({ error: '403 Forbidden: Unauthorized organization access.' });
      return;
    }
    res.status(200).json({ tenants: org.tenants });
    return;
  }
  const allTenants = context.organizations.flatMap((o) => o.tenants);
  res.status(200).json({ tenants: allTenants });
});

apiRouter.get('/tenants/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const access = resolveTenantAccess(req.user!.id, req.params.id);
  if (!access) {
    res.status(403).json({ error: '403 Forbidden: Cross-tenant access denied.' });
    return;
  }
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  res.status(200).json({ tenant, role: access.role, onlineUsers: getTenantOnlinePresence(req.params.id) });
});

apiRouter.post('/tenants', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({
    organizationId: z.string().min(1),
    name: z.string().trim().min(2, 'Branch/Tenant name must be at least 2 characters.'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid tenant payload.' });
    return;
  }

  const orgAccess = resolveOrganizationAccess(req.user!.id, parsed.data.organizationId);
  if (!orgAccess || !orgAccess.isOrgAdmin) {
    res.status(403).json({ error: '403 Forbidden: Only Org Admins can create new branch tenants.' });
    return;
  }

  const now = new Date().toISOString();
  const tenantId = crypto.randomUUID();
  const boardId = crypto.randomUUID();

  const tx = db.transaction(() => {
    db.prepare('INSERT INTO tenants (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)').run(
      tenantId,
      parsed.data.organizationId,
      parsed.data.name,
      now
    );
    db.prepare(
      'INSERT INTO boards (id, organization_id, tenant_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      boardId,
      parsed.data.organizationId,
      tenantId,
      `${parsed.data.name} Engineering Board`,
      `Default Kanban workspace for ${parsed.data.name} branch.`,
      req.user!.id,
      now
    );
    ['To Do', 'In Progress', 'Testing', 'Done'].forEach((col, i) => {
      db.prepare('INSERT INTO columns (id, board_id, tenant_id, name, position) VALUES (?, ?, ?, ?, ?)').run(
        crypto.randomUUID(),
        boardId,
        tenantId,
        col,
        i + 1
      );
    });
  });
  tx();

  recordActivity({
    tenantId,
    userId: req.user!.id,
    entityType: 'tenant',
    entityId: tenantId,
    action: 'Created',
    details: { branchName: parsed.data.name },
  });

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  res.status(201).json({ tenant });
});

apiRouter.put('/tenants/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const access = resolveTenantAccess(req.user!.id, req.params.id);
  if (!access || access.role !== 'ORG_ADMIN') {
    res.status(403).json({ error: '403 Forbidden: Only Org Admins can rename branch tenants.' });
    return;
  }
  const schema = z.object({ name: z.string().trim().min(2) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid branch name required.' });
    return;
  }
  db.prepare('UPDATE tenants SET name = ? WHERE id = ?').run(parsed.data.name, req.params.id);
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  res.status(200).json({ tenant });
});

apiRouter.delete('/tenants/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const access = resolveTenantAccess(req.user!.id, req.params.id);
  if (!access || access.role !== 'ORG_ADMIN') {
    res.status(403).json({ error: '403 Forbidden: Only Org Admins can delete branch tenants.' });
    return;
  }
  db.prepare('DELETE FROM tenants WHERE id = ?').run(req.params.id);
  res.status(200).json({ deleted: true, id: req.params.id });
});

// ============================================================================
// Memberships & Team RBAC Management APIs
// ============================================================================

apiRouter.get('/memberships', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.query.tenantId as string | undefined;
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId query parameter is required.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, tenantId);
  if (!access) {
    res.status(403).json({ error: '403 Forbidden: Unauthorized tenant membership query.' });
    return;
  }

  // Return all users authorized in this tenant (explicit tenant members + org admins of parent org)
  const members = db
    .prepare(
      `SELECT DISTINCT u.id as user_id, u.name, u.email,
              COALESCE(
                (SELECT m2.role FROM memberships m2 WHERE m2.user_id = u.id AND m2.organization_id = ? AND m2.role = 'ORG_ADMIN' LIMIT 1),
                (SELECT m3.role FROM memberships m3 WHERE m3.user_id = u.id AND m3.tenant_id = ? LIMIT 1)
              ) as role,
              (SELECT m4.id FROM memberships m4 WHERE m4.user_id = u.id AND (m4.tenant_id = ? OR (m4.organization_id = ? AND m4.tenant_id IS NULL)) LIMIT 1) as membership_id
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       WHERE m.organization_id = ?
         AND (m.tenant_id = ? OR (m.tenant_id IS NULL AND m.role = 'ORG_ADMIN'))
       ORDER BY u.name ASC`
    )
    .all(
      access.organizationId,
      tenantId,
      tenantId,
      access.organizationId,
      access.organizationId,
      tenantId
    );

  // Also list registered directory users so admins can add existing users easily
  const allUsers = hasMinimumRole(access.role, 'TENANT_ADMIN')
    ? db.prepare('SELECT id, name, email FROM users ORDER BY name ASC').all()
    : [];

  res.status(200).json({ members, directoryUsers: allUsers, callerRole: access.role });
});

apiRouter.post('/memberships', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({
    tenantId: z.string().min(1),
    email: z.string().trim().email(),
    role: z.enum(['ORG_ADMIN', 'TENANT_ADMIN', 'MEMBER']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid membership payload.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, parsed.data.tenantId);
  if (!access || !hasMinimumRole(access.role, 'TENANT_ADMIN')) {
    res.status(403).json({ error: '403 Forbidden: Minimum role TENANT_ADMIN required to manage members.' });
    return;
  }

  if (parsed.data.role === 'ORG_ADMIN' && access.role !== 'ORG_ADMIN') {
    res.status(403).json({ error: '403 Forbidden: Only Org Admins can grant ORG_ADMIN role.' });
    return;
  }

  const targetUser = db
    .prepare('SELECT id, name, email FROM users WHERE email = ?')
    .get(parsed.data.email.toLowerCase()) as { id: string; name: string; email: string } | undefined;

  if (!targetUser) {
    res.status(404).json({ error: `No registered user found with email ${parsed.data.email}.` });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM memberships WHERE user_id = ? AND tenant_id = ?')
    .get(targetUser.id, parsed.data.tenantId) as { id: string } | undefined;

  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE memberships SET role = ? WHERE id = ?').run(parsed.data.role, existing.id);
  } else {
    db.prepare(
      'INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      crypto.randomUUID(),
      targetUser.id,
      access.organizationId,
      parsed.data.role === 'ORG_ADMIN' ? null : parsed.data.tenantId,
      parsed.data.role,
      now
    );
  }

  recordActivity({
    tenantId: parsed.data.tenantId,
    userId: req.user!.id,
    entityType: 'membership',
    entityId: targetUser.id,
    action: 'Updated',
    details: { memberName: targetUser.name, memberEmail: targetUser.email, assignedRole: parsed.data.role },
  });

  res.status(201).json({ ok: true, member: { ...targetUser, role: parsed.data.role } });
});

apiRouter.delete('/memberships/:userId', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.query.tenantId as string | undefined;
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId query parameter required.' });
    return;
  }
  const access = resolveTenantAccess(req.user!.id, tenantId);
  if (!access || !hasMinimumRole(access.role, 'TENANT_ADMIN')) {
    res.status(403).json({ error: '403 Forbidden: Only Tenant Admins or Org Admins can remove members.' });
    return;
  }
  if (req.params.userId === req.user!.id) {
    res.status(400).json({ error: 'Cannot remove your own active membership.' });
    return;
  }
  db.prepare('DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?').run(req.params.userId, tenantId);
  res.status(200).json({ deleted: true });
});

// ============================================================================
// Board CRUD APIs (Strictly Tenant-Scoped)
// ============================================================================

apiRouter.get('/boards', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.query.tenantId as string | undefined;
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId query parameter is required.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, tenantId);
  if (!access) {
    res.status(403).json({
      error: `403 Forbidden: Cross-tenant access blocked. You do not belong to tenant ${tenantId}.`,
    });
    return;
  }

  const boards = db
    .prepare(
      `SELECT b.*, u.name as creator_name,
              (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id AND t.tenant_id = b.tenant_id) as task_count
       FROM boards b
       LEFT JOIN users u ON u.id = b.created_by
       WHERE b.tenant_id = ?
       ORDER BY b.created_at ASC`
    )
    .all(tenantId);

  res.status(200).json({ boards, role: access.role });
});

apiRouter.get('/boards/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id) as any;
  if (!board) {
    res.status(404).json({ error: 'Board not found.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, board.tenant_id);
  if (!access) {
    res.status(403).json({
      error: `403 Forbidden: Cross-tenant board access denied for board ${req.params.id}.`,
    });
    return;
  }

  const columns = db
    .prepare('SELECT * FROM columns WHERE board_id = ? AND tenant_id = ? ORDER BY position ASC')
    .all(board.id, board.tenant_id);

  const rawTasks = db
    .prepare(
      `SELECT t.*, u.name as assignee_name, u.email as assignee_email, c.name as column_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       JOIN columns c ON c.id = t.column_id
       WHERE t.board_id = ? AND t.tenant_id = ?
       ORDER BY t.position ASC`
    )
    .all(board.id, board.tenant_id) as any[];

  const tasks = rawTasks.map((r) => ({
    ...r,
    labels: (() => {
      try {
        return JSON.parse(r.labels || '[]');
      } catch {
        return [];
      }
    })(),
  }));

  res.status(200).json({
    board,
    columns,
    tasks,
    role: access.role,
    onlineUsers: getTenantOnlinePresence(board.tenant_id),
  });
});

apiRouter.post('/boards', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({
    tenantId: z.string().min(1),
    name: z.string().trim().min(2, 'Board name must be at least 2 characters.'),
    description: z.string().trim().optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid board input.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, parsed.data.tenantId);
  if (!access) {
    res.status(403).json({ error: '403 Forbidden: Cross-tenant board creation denied.' });
    return;
  }
  if (!hasMinimumRole(access.role, 'TENANT_ADMIN')) {
    res.status(403).json({ error: '403 Forbidden: Only Tenant Admins or Org Admins can create boards.' });
    return;
  }

  const boardId = crypto.randomUUID();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO boards (id, organization_id, tenant_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      boardId,
      access.organizationId,
      access.tenantId,
      parsed.data.name,
      parsed.data.description,
      req.user!.id,
      now
    );

    ['To Do', 'In Progress', 'Testing', 'Done'].forEach((colName, idx) => {
      db.prepare('INSERT INTO columns (id, board_id, tenant_id, name, position) VALUES (?, ?, ?, ?, ?)').run(
        crypto.randomUUID(),
        boardId,
        access.tenantId,
        colName,
        idx + 1
      );
    });
  });
  tx();

  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
  recordActivity({
    tenantId: access.tenantId,
    userId: req.user!.id,
    entityType: 'board',
    entityId: boardId,
    action: 'Created',
    details: { boardName: parsed.data.name },
  });
  emitToTenant(access.tenantId, 'board:created', { board });

  res.status(201).json({ board });
});

apiRouter.put('/boards/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id) as any;
  if (!board) {
    res.status(404).json({ error: 'Board not found.' });
    return;
  }
  const access = resolveTenantAccess(req.user!.id, board.tenant_id);
  if (!access || !hasMinimumRole(access.role, 'TENANT_ADMIN')) {
    res.status(403).json({ error: '403 Forbidden: Insufficient permissions to update board.' });
    return;
  }

  const schema = z.object({
    name: z.string().trim().min(2),
    description: z.string().trim().optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid board name is required.' });
    return;
  }

  db.prepare('UPDATE boards SET name = ?, description = ? WHERE id = ? AND tenant_id = ?').run(
    parsed.data.name,
    parsed.data.description,
    board.id,
    board.tenant_id
  );
  const updated = db.prepare('SELECT * FROM boards WHERE id = ?').get(board.id);

  recordActivity({
    tenantId: board.tenant_id,
    userId: req.user!.id,
    entityType: 'board',
    entityId: board.id,
    action: 'Updated',
    details: { boardName: parsed.data.name },
  });
  emitToTenant(board.tenant_id, 'board:updated', { board: updated });

  res.status(200).json({ board: updated });
});

apiRouter.delete('/boards/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id) as any;
  if (!board) {
    res.status(404).json({ error: 'Board not found.' });
    return;
  }
  const access = resolveTenantAccess(req.user!.id, board.tenant_id);
  if (!access || !hasMinimumRole(access.role, 'TENANT_ADMIN')) {
    res.status(403).json({ error: '403 Forbidden: Only Tenant Admins or Org Admins can delete boards.' });
    return;
  }

  db.prepare('DELETE FROM boards WHERE id = ? AND tenant_id = ?').run(board.id, board.tenant_id);
  recordActivity({
    tenantId: board.tenant_id,
    userId: req.user!.id,
    entityType: 'board',
    entityId: board.id,
    action: 'Deleted',
    details: { boardName: board.name },
  });
  emitToTenant(board.tenant_id, 'board:deleted', { boardId: board.id });

  res.status(200).json({ deleted: true, id: board.id });
});

// ============================================================================
// Column CRUD APIs
// ============================================================================

apiRouter.get('/boards/:id/columns', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id) as any;
  if (!board) {
    res.status(404).json({ error: 'Board not found.' });
    return;
  }
  const access = resolveTenantAccess(req.user!.id, board.tenant_id);
  if (!access) {
    res.status(403).json({ error: '403 Forbidden: Cross-tenant column access denied.' });
    return;
  }
  const columns = db
    .prepare('SELECT * FROM columns WHERE board_id = ? AND tenant_id = ? ORDER BY position ASC')
    .all(board.id, board.tenant_id);
  res.status(200).json({ columns });
});

apiRouter.post('/columns', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({
    boardId: z.string().min(1),
    name: z.string().trim().min(1, 'Column name is required.'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid column payload.' });
    return;
  }

  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(parsed.data.boardId) as any;
  if (!board) {
    res.status(404).json({ error: 'Board not found.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, board.tenant_id);
  if (!access || !hasMinimumRole(access.role, 'TENANT_ADMIN')) {
    res.status(403).json({ error: '403 Forbidden: Minimum role TENANT_ADMIN required to add columns.' });
    return;
  }

  const maxPosRow = db
    .prepare('SELECT COALESCE(MAX(position), 0) as maxPos FROM columns WHERE board_id = ? AND tenant_id = ?')
    .get(board.id, board.tenant_id) as { maxPos: number };

  const colId = crypto.randomUUID();
  const nextPos = maxPosRow.maxPos + 1;
  db.prepare('INSERT INTO columns (id, board_id, tenant_id, name, position) VALUES (?, ?, ?, ?, ?)').run(
    colId,
    board.id,
    board.tenant_id,
    parsed.data.name,
    nextPos
  );

  const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(colId);
  recordActivity({
    tenantId: board.tenant_id,
    userId: req.user!.id,
    entityType: 'column',
    entityId: colId,
    action: 'Created',
    details: { columnName: parsed.data.name, boardName: board.name },
  });
  emitToTenant(board.tenant_id, 'column:created', { column });

  res.status(201).json({ column });
});

apiRouter.put('/columns/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const col = db.prepare('SELECT * FROM columns WHERE id = ?').get(req.params.id) as any;
  if (!col) {
    res.status(404).json({ error: 'Column not found.' });
    return;
  }
  const access = resolveTenantAccess(req.user!.id, col.tenant_id);
  if (!access || !hasMinimumRole(access.role, 'TENANT_ADMIN')) {
    res.status(403).json({ error: '403 Forbidden: Minimum role TENANT_ADMIN required.' });
    return;
  }

  const schema = z.object({ name: z.string().trim().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Column name is required.' });
    return;
  }

  db.prepare('UPDATE columns SET name = ? WHERE id = ? AND tenant_id = ?').run(
    parsed.data.name,
    col.id,
    col.tenant_id
  );
  const updated = db.prepare('SELECT * FROM columns WHERE id = ?').get(col.id);
  emitToTenant(col.tenant_id, 'column:updated', { column: updated });
  res.status(200).json({ column: updated });
});

apiRouter.delete('/columns/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const col = db.prepare('SELECT * FROM columns WHERE id = ?').get(req.params.id) as any;
  if (!col) {
    res.status(404).json({ error: 'Column not found.' });
    return;
  }
  const access = resolveTenantAccess(req.user!.id, col.tenant_id);
  if (!access || !hasMinimumRole(access.role, 'TENANT_ADMIN')) {
    res.status(403).json({ error: '403 Forbidden: Minimum role TENANT_ADMIN required.' });
    return;
  }

  db.prepare('DELETE FROM columns WHERE id = ? AND tenant_id = ?').run(col.id, col.tenant_id);
  emitToTenant(col.tenant_id, 'column:deleted', { columnId: col.id, boardId: col.board_id });
  res.status(200).json({ deleted: true, id: col.id });
});

// ============================================================================
// Task CRUD, Drag-and-Drop Reordering & Optimistic Concurrency (HTTP 409)
// ============================================================================

apiRouter.get('/tasks', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.query.tenantId as string | undefined;
  const boardId = req.query.boardId as string | undefined;
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId query parameter is required.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, tenantId);
  if (!access) {
    res.status(403).json({
      error: `403 Forbidden: Cross-tenant task query blocked for tenant ${tenantId}.`,
    });
    return;
  }

  let sql = `
    SELECT t.*, u.name as assignee_name, u.email as assignee_email, c.name as column_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    JOIN columns c ON c.id = t.column_id
    WHERE t.tenant_id = ?
  `;
  const params: unknown[] = [tenantId];
  if (boardId) {
    sql += ' AND t.board_id = ?';
    params.push(boardId);
  }
  sql += ' ORDER BY t.position ASC';

  const rows = db.prepare(sql).all(...params) as any[];
  const tasks = rows.map((r) => ({
    ...r,
    labels: (() => {
      try {
        return JSON.parse(r.labels || '[]');
      } catch {
        return [];
      }
    })(),
  }));

  res.status(200).json({ tasks });
});

apiRouter.get('/tasks/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  // First locate task to verify tenant isolation explicitly (returns 403 on cross-tenant access!)
  const rawTask = db.prepare('SELECT id, tenant_id FROM tasks WHERE id = ?').get(req.params.id) as
    | { id: string; tenant_id: string }
    | undefined;

  if (!rawTask) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, rawTask.tenant_id);
  if (!access) {
    res.status(403).json({
      error: `403 Forbidden: Tenant isolation violation. Task ${rawTask.id} belongs to another branch (${rawTask.tenant_id}).`,
      code: 'TENANT_ISOLATION_BLOCKED',
    });
    return;
  }

  const task = hydrateTask(rawTask.id, rawTask.tenant_id);
  const taskLogs = db
    .prepare(
      `SELECT a.*, u.name as user_name
       FROM activity_logs a
       JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = ? AND a.entity_type = 'task' AND a.entity_id = ?
       ORDER BY a.created_at DESC
       LIMIT 20`
    )
    .all(rawTask.tenant_id, rawTask.id)
    .map((l: any) => ({
      ...l,
      details: (() => {
        try {
          return JSON.parse(l.details || '{}');
        } catch {
          return {};
        }
      })(),
    }));

  res.status(200).json({ task, activityLogs: taskLogs });
});

const createTaskSchema = z.object({
  boardId: z.string().min(1),
  columnId: z.string().min(1),
  title: z.string().trim().min(1, 'Task title cannot be empty.'),
  description: z.string().trim().optional().default(''),
  assignedTo: z.string().nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional().default('MEDIUM'),
  dueDate: z.string().nullable().optional(),
  labels: z.array(z.string()).optional().default([]),
});

apiRouter.post('/tasks', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid task input.' });
    return;
  }

  const { boardId, columnId, title, description, assignedTo, priority, dueDate, labels } = parsed.data;

  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as any;
  if (!board) {
    res.status(404).json({ error: 'Board not found.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, board.tenant_id);
  if (!access) {
    res.status(403).json({ error: '403 Forbidden: Cross-tenant task creation blocked.' });
    return;
  }

  const column = db
    .prepare('SELECT * FROM columns WHERE id = ? AND board_id = ? AND tenant_id = ?')
    .get(columnId, boardId, board.tenant_id) as any;

  if (!column) {
    res.status(400).json({ error: 'Column does not belong to the selected board and tenant.' });
    return;
  }

  if (assignedTo) {
    const assigneeAccess = resolveTenantAccess(assignedTo, board.tenant_id);
    if (!assigneeAccess) {
      res.status(400).json({ error: 'Assigned user does not belong to this branch tenant.' });
      return;
    }
  }

  const maxPosRow = db
    .prepare('SELECT COALESCE(MAX(position), 0) as maxPos FROM tasks WHERE column_id = ? AND tenant_id = ?')
    .get(columnId, board.tenant_id) as { maxPos: number };

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO tasks (
      id, board_id, column_id, tenant_id, title, description, assigned_to,
      priority, due_date, labels, position, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    taskId,
    boardId,
    columnId,
    board.tenant_id,
    title,
    description,
    assignedTo || null,
    priority,
    dueDate || null,
    JSON.stringify(labels),
    maxPosRow.maxPos + 1,
    now,
    now
  );

  const createdTask = hydrateTask(taskId, board.tenant_id);

  recordActivity({
    tenantId: board.tenant_id,
    userId: req.user!.id,
    entityType: 'task',
    entityId: taskId,
    action: 'Created',
    details: { title, column: column.name, priority },
  });

  emitToTenant(board.tenant_id, 'task:created', { task: createdTask });
  res.status(201).json({ task: createdTask });
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(1, 'Task title cannot be empty.'),
  description: z.string().trim().optional().default(''),
  assignedTo: z.string().nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  dueDate: z.string().nullable().optional(),
  labels: z.array(z.string()).optional().default([]),
  columnId: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive('expectedVersion is required for optimistic locking.'),
});

apiRouter.put('/tasks/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const rawTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!rawTask) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, rawTask.tenant_id);
  if (!access) {
    res.status(403).json({
      error: `403 Forbidden: Tenant isolation violation on task ${rawTask.id}.`,
      code: 'TENANT_ISOLATION_BLOCKED',
    });
    return;
  }

  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid task update payload.' });
    return;
  }

  const { title, description, assignedTo, priority, dueDate, labels, columnId, expectedVersion } = parsed.data;

  if (assignedTo) {
    const assigneeAccess = resolveTenantAccess(assignedTo, rawTask.tenant_id);
    if (!assigneeAccess) {
      res.status(400).json({ error: 'Assigned user is not a member of this branch tenant.' });
      return;
    }
  }

  const targetColId = columnId || rawTask.column_id;
  const colRow = db
    .prepare('SELECT * FROM columns WHERE id = ? AND board_id = ? AND tenant_id = ?')
    .get(targetColId, rawTask.board_id, rawTask.tenant_id) as any;

  if (!colRow) {
    res.status(400).json({ error: 'Target column is invalid for this board.' });
    return;
  }

  let conflictDetected = false;

  const tx = db.transaction(() => {
    const current = db
      .prepare('SELECT version FROM tasks WHERE id = ? AND tenant_id = ?')
      .get(rawTask.id, rawTask.tenant_id) as { version: number } | undefined;

    if (!current || current.version !== expectedVersion) {
      conflictDetected = true;
      return;
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE tasks
         SET title = ?, description = ?, assigned_to = ?, priority = ?, due_date = ?,
             labels = ?, column_id = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND version = ?`
      )
      .run(
        title,
        description,
        assignedTo || null,
        priority,
        dueDate || null,
        JSON.stringify(labels),
        targetColId,
        now,
        rawTask.id,
        rawTask.tenant_id,
        expectedVersion
      );

    if (result.changes === 0) {
      conflictDetected = true;
    }
  });

  tx();

  if (conflictDetected) {
    const latestTask = hydrateTask(rawTask.id, rawTask.tenant_id);
    res.status(409).json({
      error: `Version conflict: You edited v${expectedVersion}, but server is already at v${latestTask?.version}.`,
      code: 'VERSION_CONFLICT',
      serverTask: latestTask,
    });
    return;
  }

  const updatedTask = hydrateTask(rawTask.id, rawTask.tenant_id);
  recordActivity({
    tenantId: rawTask.tenant_id,
    userId: req.user!.id,
    entityType: 'task',
    entityId: rawTask.id,
    action: 'Updated',
    details: { title, version: updatedTask?.version, priority },
  });

  emitToTenant(rawTask.tenant_id, 'task:updated', { task: updatedTask });
  res.status(200).json({ task: updatedTask });
});

const moveTaskSchema = z.object({
  destinationColumnId: z.string().min(1),
  newPosition: z.number().int().min(1),
  expectedVersion: z.number().int().positive(),
});

apiRouter.patch('/tasks/:id/move', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const rawTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!rawTask) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, rawTask.tenant_id);
  if (!access) {
    res.status(403).json({
      error: '403 Forbidden: Cross-tenant task movement blocked.',
      code: 'TENANT_ISOLATION_BLOCKED',
    });
    return;
  }

  const parsed = moveTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid move payload.' });
    return;
  }

  const { destinationColumnId, newPosition, expectedVersion } = parsed.data;

  const destCol = db
    .prepare('SELECT * FROM columns WHERE id = ? AND board_id = ? AND tenant_id = ?')
    .get(destinationColumnId, rawTask.board_id, rawTask.tenant_id) as any;

  if (!destCol) {
    res.status(400).json({ error: 'Destination column does not belong to this board and tenant.' });
    return;
  }

  const sourceCol = db
    .prepare('SELECT * FROM columns WHERE id = ? AND tenant_id = ?')
    .get(rawTask.column_id, rawTask.tenant_id) as any;

  let conflictDetected = false;

  const tx = db.transaction(() => {
    const current = db
      .prepare('SELECT column_id, position, version FROM tasks WHERE id = ? AND tenant_id = ?')
      .get(rawTask.id, rawTask.tenant_id) as { column_id: string; position: number; version: number } | undefined;

    if (!current || current.version !== expectedVersion) {
      conflictDetected = true;
      return;
    }

    const now = new Date().toISOString();

    if (current.column_id === destinationColumnId) {
      const siblings = db
        .prepare('SELECT id FROM tasks WHERE column_id = ? AND tenant_id = ? AND id != ? ORDER BY position ASC')
        .all(destinationColumnId, rawTask.tenant_id, rawTask.id) as Array<{ id: string }>;

      const clampedIdx = Math.min(Math.max(newPosition - 1, 0), siblings.length);
      siblings.splice(clampedIdx, 0, { id: rawTask.id });

      const updatePos = db.prepare('UPDATE tasks SET position = ? WHERE id = ? AND tenant_id = ?');
      siblings.forEach((item, idx) => {
        updatePos.run(idx + 1, item.id, rawTask.tenant_id);
      });

      db.prepare('UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ? AND tenant_id = ?').run(
        now,
        rawTask.id,
        rawTask.tenant_id
      );
    } else {
      // Re-index source column excluding moved task
      const sourceSiblings = db
        .prepare('SELECT id FROM tasks WHERE column_id = ? AND tenant_id = ? AND id != ? ORDER BY position ASC')
        .all(current.column_id, rawTask.tenant_id, rawTask.id) as Array<{ id: string }>;

      const updatePos = db.prepare('UPDATE tasks SET position = ? WHERE id = ? AND tenant_id = ?');
      sourceSiblings.forEach((item, idx) => {
        updatePos.run(idx + 1, item.id, rawTask.tenant_id);
      });

      // Insert into destination column at clamped position
      const destSiblings = db
        .prepare('SELECT id FROM tasks WHERE column_id = ? AND tenant_id = ? AND id != ? ORDER BY position ASC')
        .all(destinationColumnId, rawTask.tenant_id, rawTask.id) as Array<{ id: string }>;

      const clampedIdx = Math.min(Math.max(newPosition - 1, 0), destSiblings.length);
      destSiblings.splice(clampedIdx, 0, { id: rawTask.id });

      db.prepare(
        'UPDATE tasks SET column_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND tenant_id = ?'
      ).run(destinationColumnId, now, rawTask.id, rawTask.tenant_id);

      destSiblings.forEach((item, idx) => {
        updatePos.run(idx + 1, item.id, rawTask.tenant_id);
      });
    }
  });

  tx();

  if (conflictDetected) {
    const latestTask = hydrateTask(rawTask.id, rawTask.tenant_id);
    res.status(409).json({
      error: `Concurrent move conflict: Task was already updated to v${latestTask?.version}.`,
      code: 'VERSION_CONFLICT',
      serverTask: latestTask,
    });
    return;
  }

  // Fetch authoritative ordered tasks for affected board to guarantee consistent ordering across all collaborators
  const boardTasks = (
    db
      .prepare(
        `SELECT t.*, u.name as assignee_name, u.email as assignee_email, c.name as column_name
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         JOIN columns c ON c.id = t.column_id
         WHERE t.board_id = ? AND t.tenant_id = ?
         ORDER BY t.position ASC`
      )
      .all(rawTask.board_id, rawTask.tenant_id) as any[]
  ).map((r) => ({
    ...r,
    labels: (() => {
      try {
        return JSON.parse(r.labels || '[]');
      } catch {
        return [];
      }
    })(),
  }));

  const movedTask = boardTasks.find((t) => t.id === rawTask.id);

  recordActivity({
    tenantId: rawTask.tenant_id,
    userId: req.user!.id,
    entityType: 'task',
    entityId: rawTask.id,
    action: 'Moved',
    details: {
      title: rawTask.title,
      from: sourceCol?.name || 'Previous',
      to: destCol.name,
      position: movedTask?.position,
      version: movedTask?.version,
    },
  });

  emitToTenant(rawTask.tenant_id, 'task:moved', {
    task: movedTask,
    boardId: rawTask.board_id,
    boardTasks,
  });

  res.status(200).json({ task: movedTask, boardTasks });
});

apiRouter.delete('/tasks/:id', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const rawTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
  if (!rawTask) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, rawTask.tenant_id);
  if (!access) {
    res.status(403).json({
      error: '403 Forbidden: Cross-tenant task deletion blocked.',
      code: 'TENANT_ISOLATION_BLOCKED',
    });
    return;
  }

  db.prepare('DELETE FROM tasks WHERE id = ? AND tenant_id = ?').run(rawTask.id, rawTask.tenant_id);

  recordActivity({
    tenantId: rawTask.tenant_id,
    userId: req.user!.id,
    entityType: 'task',
    entityId: rawTask.id,
    action: 'Deleted',
    details: { title: rawTask.title },
  });

  emitToTenant(rawTask.tenant_id, 'task:deleted', {
    taskId: rawTask.id,
    boardId: rawTask.board_id,
  });

  res.status(200).json({ deleted: true, id: rawTask.id });
});

// ============================================================================
// Activity Logs API (Strictly Tenant-Scoped)
// ============================================================================

apiRouter.get('/activity-logs', authenticateMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.query.tenantId as string | undefined;
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId query parameter is required.' });
    return;
  }

  const access = resolveTenantAccess(req.user!.id, tenantId);
  if (!access) {
    res.status(403).json({ error: '403 Forbidden: Cross-tenant activity log access blocked.' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT a.*, u.name as user_name, u.email as user_email
       FROM activity_logs a
       JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = ?
       ORDER BY a.created_at DESC
       LIMIT 60`
    )
    .all(tenantId) as any[];

  const logs = rows.map((r) => ({
    ...r,
    details: (() => {
      try {
        return JSON.parse(r.details || '{}');
      } catch {
        return {};
      }
    })(),
  }));

  res.status(200).json({ logs });
});

// ============================================================================
// Agentic AI Kanban Assistant Endpoint (Verified Tenant Context Only)
// ============================================================================

apiRouter.post('/ai/assistant', authenticateMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({
    tenantId: z.string().min(1),
    boardId: z.string().optional(),
    question: z.string().trim().min(2, 'Please enter a question for the workspace assistant.'),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid assistant request.' });
    return;
  }

  // Server verifies tenant membership; never trusts browser-supplied context blindly
  const access = resolveTenantAccess(req.user!.id, parsed.data.tenantId);
  if (!access) {
    res.status(403).json({ error: '403 Forbidden: Unauthorized tenant context for AI assistant.' });
    return;
  }

  try {
    const result = await runTenantKanbanAgent({
      question: parsed.data.question,
      tenantId: access.tenantId,
      tenantName: access.tenantName,
      boardId: parsed.data.boardId,
      userName: req.user!.name,
    });
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({
      error: err?.message || 'Failed to process AI workspace query.',
    });
  }
});

// ============================================================================
// Assignment Deliverable Files Reader (Serves Real Repo Docs to Website UI)
// ============================================================================

apiRouter.get('/docs/files', (_req, res) => {
  const deliverablePaths: Record<string, string> = {
    readme: 'README.md',
    sqlSchema: 'database/schema.sql',
    prismaSchema: 'database/prisma/schema.prisma',
    apiDocs: 'docs/api-documentation.md',
    wsDocs: 'docs/websocket-documentation.md',
    erdDocs: 'docs/database-erd.md',
    pythonAi: 'ai-service/main.py',
  };

  const files: Record<string, string> = {};
  for (const [key, relPath] of Object.entries(deliverablePaths)) {
    const fullPath = path.resolve(process.cwd(), relPath);
    if (fs.existsSync(fullPath)) {
      files[key] = fs.readFileSync(fullPath, 'utf-8');
    } else {
      files[key] = '';
    }
  }
  res.status(200).json({ files });
});
