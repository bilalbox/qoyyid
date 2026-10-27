import { generatePresignedGetUrl } from "./presign";
import type { Env } from "./types";

/**
 * Worker-internal Mistral API client. MISTRAL_API_KEY is injected here and
 * never leaves the Worker — the Svelte client never talks to Mistral
 * directly (see plan §5). Not exposed as public routes.
 */

const MISTRAL_API = "https://api.mistral.ai/v1";
const OCR_MODEL = "mistral-ocr-latest";
const AUDIO_MODEL = "voxtral-mini-latest";

function authHeaders(env: Env): Record<string, string> {
	return { Authorization: `Bearer ${env.MISTRAL_API_KEY}` };
}

async function mistralJson<T>(
	env: Env,
	path: string,
	init: RequestInit,
): Promise<T> {
	const res = await fetch(`${MISTRAL_API}${path}`, {
		...init,
		headers: { ...authHeaders(env), ...(init.headers ?? {}) },
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(
			`Mistral API ${init.method ?? "GET"} ${path}: HTTP ${res.status}: ${detail}`,
		);
	}
	return res.json() as Promise<T>;
}

export async function uploadFileToMistral(
	env: Env,
	bytes: ArrayBuffer,
	filename: string,
	purpose: "ocr" | "batch",
): Promise<string> {
	const form = new FormData();
	form.append("purpose", purpose);
	form.append("file", new Blob([bytes]), filename);
	const result = await mistralJson<{ id: string }>(env, "/files", {
		method: "POST",
		body: form,
	});
	return result.id;
}

/**
 * Wraps the PDF file_id in a single-line JSONL batch input, uploads it, and
 * submits a batch OCR job referencing it. Returns the batch job id.
 *
 * Confirmed against a real batch run (2026-07-01): `{ type: "file", file_id }`
 * is the correct document reference shape for a Files-API-uploaded PDF.
 */
export async function submitBatchOcrJob(
	env: Env,
	jobId: string,
	pdfFileId: string,
): Promise<string> {
	const batchLine = {
		custom_id: jobId,
		body: {
			model: OCR_MODEL,
			document: { type: "file", file_id: pdfFileId },
			// Structural metadata (confirmed against a real sync /v1/ocr run,
			// 2026-07-03, fixtures/mistral/ocr-blocks-page.json): typed blocks with
			// pixel bboxes, and header/footer text *removed from markdown* into the
			// page's header/footer fields. mistral-mapping.ts consumes these.
			include_blocks: true,
			extract_header: true,
			extract_footer: true,
			table_format: "markdown",
			confidence_scores_granularity: "block",
		},
	};
	const jsonl = `${JSON.stringify(batchLine)}\n`;
	const jsonlFileId = await uploadFileToMistral(
		env,
		new TextEncoder().encode(jsonl).buffer as ArrayBuffer,
		`${jobId}.jsonl`,
		"batch",
	);

	const job = await mistralJson<{ id: string }>(env, "/batch/jobs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			input_files: [jsonlFileId],
			model: OCR_MODEL,
			endpoint: "/v1/ocr",
			timeout_hours: 24,
		}),
	});
	return job.id;
}

export async function submitBatchAudioJob(
	env: Env,
	jobId: string,
	fileKey: string,
): Promise<string> {
	const fileUrl = await generatePresignedGetUrl(env, fileKey);
	const batchLine = {
		custom_id: jobId,
		body: {
			model: AUDIO_MODEL,
			file_url: fileUrl,
			diarize: true,
			// Segment timestamps + speaker ids (confirmed against a real sync run,
			// 2026-07-03, fixtures/mistral/audio-segments.json). Do not also set
			// `language` — documented as incompatible with timestamps.
			timestamp_granularities: ["segment"],
		},
	};
	const jsonl = `${JSON.stringify(batchLine)}\n`;
	const jsonlFileId = await uploadFileToMistral(
		env,
		new TextEncoder().encode(jsonl).buffer as ArrayBuffer,
		`${jobId}.jsonl`,
		"batch",
	);

	const job = await mistralJson<{ id: string }>(env, "/batch/jobs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			input_files: [jsonlFileId],
			model: AUDIO_MODEL,
			endpoint: "/v1/audio/transcriptions",
			timeout_hours: 24,
		}),
	});
	return job.id;
}

export interface MistralBatchJobStatus {
	id: string;
	status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED" | string;
	output_file?: string | null;
	error_file?: string | null;
	// Batch-level error summary (e.g. `[{ message: "HTTP Error, status code: 504", count: 1 }]`)
	// — present even when `errors` in a per-request line would need `error_file` to see.
	errors?: { message: string; count: number }[] | null;
}

export async function pollBatchStatus(
	env: Env,
	batchJobId: string,
): Promise<MistralBatchJobStatus> {
	return mistralJson<MistralBatchJobStatus>(env, `/batch/jobs/${batchJobId}`, {
		method: "GET",
	});
}

/**
 * A typed content block from Mistral OCR 4 / 4.1 when `include_blocks: true`
 * is set. Confirmed against a real sync run (2026-07-03,
 * fixtures/mistral/ocr-blocks-page.json): pixel coordinates in page space,
 * `content` is the block's markdown text. Documented types: text, title,
 * list, table, image, equation, caption, code, references, aside_text,
 * header, footer, signature. Footnote zones come back as `references`.
 *
 * In OCR 4.1 (`confidence_scores_granularity: "block"`), confidence scores
 * are included per block.
 */
export interface MistralOcrBlock {
	type: string;
	top_left_x: number;
	top_left_y: number;
	bottom_right_x: number;
	bottom_right_y: number;
	content?: string;
	table_id?: string;
	image_id?: string;
	confidence?: number;
	average_content_confidence_score?: number;
}

/**
 * A page in Mistral OCR's response. With `include_blocks`/`extract_header`/
 * `extract_footer` in the request (confirmed 2026-07-03), `blocks` is
 * populated and header/footer text is *removed from markdown* into the
 * `header`/`footer` fields. Older stored responses (pre-2026-07-03 jobs) have
 * none of these — mistral-mapping.ts falls back to markdown-only parsing.
 */
export interface MistralOcrPage {
	index: number;
	markdown: string;
	dimensions?: { width: number; height: number; dpi?: number };
	blocks?: MistralOcrBlock[] | null;
	header?: string | null;
	footer?: string | null;
}

/**
 * One diarized transcription segment. Confirmed against a real sync run
 * (2026-07-03, fixtures/mistral/audio-segments.json):
 * `{ text, start, end, speaker_id: "speaker_1", type: "transcription_segment" }`.
 */
export interface MistralAudioSegment {
	text: string;
	start: number;
	end: number;
	speaker_id?: string | null;
	type?: string;
}

export interface MistralBatchResultLine {
	custom_id: string;
	response?: {
		body?: {
			pages?: MistralOcrPage[];
			text?: string;
			segments?: MistralAudioSegment[] | null;
			// Confirmed against a real sync /v1/audio/transcriptions run
			// (2026-07-03): usage.prompt_audio_seconds is present as documented.
			usage?: { prompt_audio_seconds?: number };
		};
	};
	error?: unknown;
}
/**
 * Downloads and parses the batch output JSONL. Confirmed against a real
 * completed batch job (2026-07-01): the endpoint path below is correct.
 */
export async function fetchBatchResult(
	env: Env,
	outputFileId: string,
): Promise<MistralBatchResultLine[]> {
	const res = await fetch(`${MISTRAL_API}/files/${outputFileId}/content`, {
		headers: authHeaders(env),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(
			`Mistral API GET /files/${outputFileId}/content: HTTP ${res.status}: ${detail}`,
		);
	}
	const text = await res.text();
	return text
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as MistralBatchResultLine);
}

/**
 * One line of a batch job's error_file — the per-request failure Mistral
 * routes here instead of output_file. Confirmed against a real failed batch
 * request (2026-07-14): `{ id, custom_id, response: { status_code, body },
 * error }`.
 */
export interface MistralBatchErrorLine {
	id: string;
	custom_id: string;
	response?: { status_code?: number; body?: string } | null;
	error?: unknown;
}

/** Downloads and parses a batch job's error_file JSONL (see fetchBatchResult). */
export async function fetchBatchErrors(
	env: Env,
	errorFileId: string,
): Promise<MistralBatchErrorLine[]> {
	const res = await fetch(`${MISTRAL_API}/files/${errorFileId}/content`, {
		headers: authHeaders(env),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(
			`Mistral API GET /files/${errorFileId}/content: HTTP ${res.status}: ${detail}`,
		);
	}
	const text = await res.text();
	return text
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as MistralBatchErrorLine);
}
