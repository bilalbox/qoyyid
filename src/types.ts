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
  | "paragraph";

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
  MISTRAL_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ADMIN_EMAILS: string;
}

export interface JobRow {
  id: string;
  user_id: string;
  sha256: string;
  pdf_key: string;
  status: string;
  title: string | null;
  total_pages: number;
  mistral_file_id: string | null;
  mistral_batch_job_id: string | null;
  mistral_pages_processed: number | null;
  error: string | null;
}
