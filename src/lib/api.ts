export interface Job {
  id: string;
  sha256: string;
  status: string;
  title: string | null;
  total_pages: number;
  mistral_pages_processed: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const TERMINAL_STATUSES = new Set(["done", "failed"]);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  return res;
}

export async function listJobs(): Promise<Job[]> {
  const res = await apiFetch("/jobs");
  if (!res.ok) throw new Error(`failed to list jobs: ${res.status}`);
  const data = (await res.json()) as { jobs: Job[] };
  return data.jobs;
}

export async function getJob(id: string): Promise<Job> {
  const res = await apiFetch(`/jobs/${id}`);
  if (!res.ok) throw new Error(`failed to fetch job: ${res.status}`);
  return res.json() as Promise<Job>;
}

export async function uploadJob(file: File): Promise<{ job_id: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch("/jobs", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ job_id: string }>;
}
