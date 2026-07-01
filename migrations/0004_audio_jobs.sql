-- Expand jobs for ASR
ALTER TABLE jobs ADD COLUMN modality TEXT NOT NULL DEFAULT 'pdf';
ALTER TABLE jobs RENAME COLUMN pdf_key TO file_key;
ALTER TABLE jobs RENAME COLUMN total_pages TO source_units;
ALTER TABLE jobs RENAME COLUMN mistral_pages_processed TO mistral_units_processed;
