import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'tenantflow-fde-assignment-jwt-secret-2026';

export type RoleType = 'ORG_ADMIN' | 'TENANT_ADMIN' | 'MEMBER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  tenantAccess?: {
    tenantId: string;
    organizationId: string;
    role: RoleType;
  };
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; email: string; name: string };
    const row = db
      .prepare('SELECT id, name, email FROM users WHERE id = ?')
      .get(decoded.sub) as AuthUser | undefined;
    return row || null;
  } catch {
    return null;
  }
}

export function authenticateMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Provide Bearer JWT token.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired JWT token.' });
    return;
  }
  req.user = user;
  next();
}

const ROLE_WEIGHT: Record<RoleType, number> = {
  ORG_ADMIN: 3,
  TENANT_ADMIN: 2,
  MEMBER: 1,
};

export function hasMinimumRole(actual: RoleType, minimum: RoleType): boolean {
  return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[minimum];
}

/**
 * Resolves a user's highest authorized role for a given tenant.
 * Returns null if the user has neither direct tenant membership nor ORG_ADMIN on the parent organization.
 */
export function resolveTenantAccess(
  userId: string,
  tenantId: string
): { tenantId: string; organizationId: string; tenantName: string; role: RoleType } | null {
  const tenant = db
    .prepare('SELECT id, organization_id, name FROM tenants WHERE id = ?')
    .get(tenantId) as { id: string; organization_id: string; name: string } | undefined;

  if (!tenant) {
    return null;
  }

  const memberships = db
    .prepare(
      `SELECT role, tenant_id FROM memberships
       WHERE user_id = ? AND organization_id = ?
         AND (tenant_id = ? OR (tenant_id IS NULL AND role = 'ORG_ADMIN'))`
    )
    .all(userId, tenant.organization_id, tenantId) as Array<{ role: RoleType; tenant_id: string | null }>;

  if (memberships.length === 0) {
    return null;
  }

  let highestRole: RoleType = 'MEMBER';
  for (const m of memberships) {
    if (ROLE_WEIGHT[m.role] > ROLE_WEIGHT[highestRole]) {
      highestRole = m.role;
    }
  }

  return {
    tenantId: tenant.id,
    organizationId: tenant.organization_id,
    tenantName: tenant.name,
    role: highestRole,
  };
}

/**
 * Resolves a user's highest role within an organization (either org-level or across its tenants).
 */
export function resolveOrganizationAccess(
  userId: string,
  organizationId: string
): { organizationId: string; highestRole: RoleType; isOrgAdmin: boolean } | null {
  const memberships = db
    .prepare('SELECT role, tenant_id FROM memberships WHERE user_id = ? AND organization_id = ?')
    .all(userId, organizationId) as Array<{ role: RoleType; tenant_id: string | null }>;

  if (memberships.length === 0) {
    return null;
  }

  let highestRole: RoleType = 'MEMBER';
  let isOrgAdmin = false;
  for (const m of memberships) {
    if (m.role === 'ORG_ADMIN') {
      isOrgAdmin = true;
    }
    if (ROLE_WEIGHT[m.role] > ROLE_WEIGHT[highestRole]) {
      highestRole = m.role;
    }
  }

  return { organizationId, highestRole, isOrgAdmin };
}
