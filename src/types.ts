export type RoleType = 'ORG_ADMIN' | 'TENANT_ADMIN' | 'MEMBER';
export type PriorityType = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Tenant {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
  role: RoleType;
}

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  highestRole: RoleType;
  isOrgAdmin: boolean;
  tenants: Tenant[];
}

export interface Board {
  id: string;
  organization_id: string;
  tenant_id: string;
  name: string;
  description: string;
  created_by: string;
  creator_name?: string;
  task_count?: number;
  created_at: string;
}

export interface BoardColumn {
  id: string;
  board_id: string;
  tenant_id: string;
  name: string;
  position: number;
}

export interface Task {
  id: string;
  board_id: string;
  column_id: string;
  column_name?: string;
  tenant_id: string;
  title: string;
  description: string;
  assigned_to: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
  priority: PriorityType;
  due_date: string | null;
  labels: string[];
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  tenant_id: string;
  user_id: string;
  user_name: string;
  user_email?: string;
  entity_type: string;
  entity_id: string;
  action: string;
  details: Record<string, any>;
  created_at: string;
}

export interface PresenceEntry {
  userId: string;
  name: string;
  email: string;
  role: RoleType;
  tabCount: number;
  connectedAt: string;
}

export interface TenantMember {
  user_id: string;
  name: string;
  email: string;
  role: RoleType;
  membership_id?: string;
}

export interface DemoAccount {
  name: string;
  email: string;
  password: string;
  organization: string;
  branch: string;
  role: RoleType;
  summary: string;
}
