import { sha256Hex } from "../hash";

export interface Job {
	id: string;
	sha256: string;
	status: string;
	title: string | null;
	source_units: number;
	mistral_units_processed: number | null;
	error: string | null;
	created_at: string;
	updated_at: string;
}

const TERMINAL_STATUSES = new Set(["done", "failed"]);

export function isTerminal(status: string): boolean {
	return TERMINAL_STATUSES.has(status);
}

export async function apiFetch(
	path: string,
	init?: RequestInit,
): Promise<Response> {
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

async function throwOnError(res: Response): Promise<void> {
	if (res.ok) return;
	const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
	throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
}

export async function uploadJob(file: File): Promise<{ job_id: string }> {
	if (file.type === "application/pdf") {
		const form = new FormData();
		form.append("file", file);
		const res = await apiFetch("/jobs", { method: "POST", body: form });
		await throwOnError(res);
		return res.json() as Promise<{ job_id: string }>;
	} else if (file.type.startsWith("audio/")) {
		const sha256 = await sha256Hex(await file.arrayBuffer());
		const res = await apiFetch("/jobs/audio-upload", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sha256,
				filename: file.name,
				contentType: file.type,
			}),
		});
		await throwOnError(res);
		const data = (await res.json()) as {
			job_id: string;
			uploadUrl?: string;
			deduplicated?: boolean;
		};

		if (!data.deduplicated && data.uploadUrl) {
			const putRes = await fetch(data.uploadUrl, {
				method: "PUT",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!putRes.ok)
				throw new Error(`failed to upload to R2: ${putRes.status}`);

			const startRes = await apiFetch(`/jobs/${data.job_id}/start-audio`, {
				method: "POST",
			});
			if (!startRes.ok)
				throw new Error(`failed to start audio job: ${startRes.status}`);
		}
		return { job_id: data.job_id };
	} else {
		throw new Error(`Unsupported file type: ${file.type}`);
	}
}
