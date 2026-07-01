import { apiFetch } from "./api";

export interface AdminUser {
  id: string;
  email: string;
  is_admin: boolean;
  quota_pages_limit: number;
  quota_pages_used: number;
  quota_minutes_limit: number;
  quota_minutes_used: number;
  created_at: string;
  job_count: number;
}

export interface AdminInvite {
  email: string;
  created_at: string;
  used_at: string | null;
}

export interface AdminJob {
  id: string;
  title: string | null;
  user_email: string;
  status: string;
  error: string | null;
  created_at: string;
  available: { pdf: boolean; response: boolean; document: boolean; docx: boolean };
}

async function unwrap<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error ?? `failed to ${action}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listUsers(): Promise<AdminUser[]> {
  const { users } = await unwrap<{ users: AdminUser[] }>(await apiFetch("/admin/api/users"), "list users");
  return users;
}

export async function setUserQuota(id: string, quota_pages_limit: number): Promise<void> {
  await unwrap(
    await apiFetch(`/admin/api/users/${id}/quota`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quota_pages_limit }),
    }),
    "update quota",
  );
}

export async function listInvites(): Promise<AdminInvite[]> {
  const { invites } = await unwrap<{ invites: AdminInvite[] }>(
    await apiFetch("/admin/api/invites"),
    "list invites",
  );
  return invites;
}

export async function createInvite(email: string): Promise<void> {
  await unwrap(
    await apiFetch("/admin/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
    "create invite",
  );
}

export async function listAdminJobs(): Promise<AdminJob[]> {
  const { jobs } = await unwrap<{ jobs: AdminJob[] }>(await apiFetch("/admin/api/jobs"), "list jobs");
  return jobs;
}

export async function reproduceDocument(id: string): Promise<void> {
  await unwrap(await apiFetch(`/admin/api/jobs/${id}/reproduce-document`, { method: "POST" }), "reproduce document");
}

export async function reproduceDocx(id: string): Promise<void> {
  await unwrap(await apiFetch(`/admin/api/jobs/${id}/reproduce-docx`, { method: "POST" }), "reproduce docx");
}
