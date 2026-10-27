/** Mirrors qoyyid/core/document.py JSON shape. */

export type BlockType =
	| "title"
	| "h1"
	| "h2"
	| "h3"
	| "body"
	| "matn"
	| "sharh"
	| "hashiya"
	| "footnote"
	| "heading"
	| "paragraph"
	| "table"
	| "question"
	| "answer";

export interface Line {
	text: string;
	confidence?: number;
	bbox?: number[] | null;
}

export interface Block {
	type: BlockType;
	reading_order?: number;
	bbox?: number[] | null;
	confidence?: number;
	level?: number | null;
	lines: Line[];
}

export interface Page {
	index: number;
	width?: number;
	height?: number;
	/** Printed page number from the scan's running header/footer (e.g. "١٦٦"),
	 *  when OCR isolates one — used for the page marker so citations can match
	 *  the physical edition. Falls back to sequential index when absent. */
	label?: string;
	blocks: Block[];
}

export interface SourceInfo {
	input?: string;
	resolved_path?: string;
	sha256?: string;
	modality?: string;
}

export interface Metadata {
	title?: string | null;
	page_count?: number;
	languages?: string[];
	engines_used?: string[];
}

export interface Document {
	source?: SourceInfo;
	metadata?: Metadata;
	pages?: Page[];
	text?: string;
	text_normalized?: string;
}

export interface Env {
	BUCKET: R2Bucket;
	DB: D1Database;
	ASSETS: Fetcher;
	MISTRAL_API_KEY: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	ADMIN_EMAILS: string;
	TURNSTILE_SECRET_KEY: string;
	FCM_SERVICE_ACCOUNT_JSON: string;
	CLOUDFLARE_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_BUCKET_NAME: string;
}

export interface JobRow {
	id: string;
	user_id: string;
	sha256: string;
	file_key: string;
	status: string;
	title: string | null;
	modality: "pdf" | "audio";
	source_units: number;
	mistral_file_id: string | null;
	mistral_batch_job_id: string | null;
	mistral_units_processed: number | null;
	error: string | null;
}
