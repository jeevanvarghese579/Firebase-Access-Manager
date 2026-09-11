export type View = "dashboard" | "users" | "apps" | "admins";

export interface WebApp {
  firebaseAppId: string;
  displayName: string;
  projectId: string;
  platform: "WEB";
  active: boolean;
  state?: string;
  lastSyncedAt?: string;
}

export interface AccessUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
  apps: Record<string, boolean>;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminRecord {
  id: string;
  uid?: string;
  email: string;
  name: string;
  active: boolean;
  pending?: boolean;
  createdAt?: string;
}

export interface AdminData {
  users: AccessUser[];
  apps: WebApp[];
  admins: AdminRecord[];
}
