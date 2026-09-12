export type View = "dashboard" | "users" | "apps" | "requests" | "admins";

export interface WebApp {
  firebaseAppId: string;
  displayName: string;
  projectId: string;
  platform: "WEB";
  active: boolean;
  requireEmailVerification?: boolean;
  state?: string;
  lastSyncedAt?: string;
}

export interface AccessUser {
  id: string;
  uid?: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
  apps: Record<string, boolean>;
  appExpirations?: Record<string, string>;
  providerIds?: string[];
  pendingIdentity?: boolean;
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
  requests: AccessRequest[];
}

export type RequestStatus = "pending" | "approved" | "rejected";

export interface AccessRequest {
  id: string;
  email: string;
  uid: string;
  displayName: string;
  providerIds?: string[];
  firebaseAppId: string;
  appDisplayName: string;
  status: RequestStatus;
  requestType?: "new-account" | "access-request";
  requestedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewedByEmail?: string;
  message?: string;
  reviewNote?: string;
}
