import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocumentAndDocx, type JobForBuild } from "../src/merge";
import type { MistralBatchResultLine } from "../src/mistral";

describe("buildDocumentAndDocx (Pipeline Core)", () => {
	it("processes PDF batch result into Document and valid docx buffer", async () => {
		const fixturePath = resolve(
			__dirname,
			"../fixtures/mistral/ocr-blocks-page.json",
		);
		const raw = JSON.parse(readFileSync(fixturePath, "utf8"));

		const resultLine: MistralBatchResultLine = {
			custom_id: "job-pdf-1",
			response: {
				body: raw,
			},
		};

		const job: JobForBuild = {
			file_key: "uploads/sample.pdf",
			sha256: "abcdef123456",
			title: "شرح الورقات",
			modality: "pdf",
		};

		const { doc, docx, unitsProcessed } = await buildDocumentAndDocx(
			job,
			"job-pdf-1",
			resultLine,
		);

		// Units processed for OCR should match page count
		expect(unitsProcessed).toBe(1);
		expect(doc.source?.modality).toBe("pdf");
		expect(doc.metadata?.title).toBe("شرح الورقات");
		expect(doc.metadata?.page_count).toBe(1);
		expect(doc.metadata?.engines_used).toEqual([
			"mistral-ocr-latest",
			"cloud-orchestrator",
		]);

		// Docx buffer is a valid zip (starts with PK\x03\x04)
		expect(docx).toBeInstanceOf(Uint8Array);
		expect(docx.length).toBeGreaterThan(1000);
		expect(docx[0]).toBe(0x50); // P
		expect(docx[1]).toBe(0x4b); // K
		expect(docx[2]).toBe(0x03);
		expect(docx[3]).toBe(0x04);
	});

	it("processes Audio batch result and calculates rounded-up billed minutes", async () => {
		const fixturePath = resolve(
			__dirname,
			"../fixtures/mistral/audio-segments.json",
		);
		const raw = JSON.parse(readFileSync(fixturePath, "utf8"));

		const resultLine: MistralBatchResultLine = {
			custom_id: "job-audio-1",
			response: {
				body: raw,
			},
		};

		const job: JobForBuild = {
			file_key: "uploads/sample.mp3",
			sha256: "fedcba654321",
			title: "درس صوتي",
			modality: "audio",
		};

		const { doc, docx, unitsProcessed } = await buildDocumentAndDocx(
			job,
			"job-audio-1",
			resultLine,
		);

		// 6 seconds in fixture -> ceil(6 / 60) = 1 minute
		expect(unitsProcessed).toBe(1);
		expect(doc.source?.modality).toBe("audio");
		expect(doc.metadata?.title).toBe("درس صوتي");
		expect(doc.metadata?.engines_used).toEqual([
			"voxtral-mini-latest",
			"cloud-orchestrator",
		]);

		// Docx generated
		expect(docx[0]).toBe(0x50);
		expect(docx[1]).toBe(0x4b);
	});

	it("throws if PDF batch output has no pages", async () => {
		const emptyResultLine: MistralBatchResultLine = {
			custom_id: "job-empty-pdf",
			response: {
				body: { pages: [] },
			},
		};

		const job: JobForBuild = {
			file_key: "uploads/empty.pdf",
			sha256: "0000",
			title: null,
			modality: "pdf",
		};

		await expect(
			buildDocumentAndDocx(job, "job-empty-pdf", emptyResultLine),
		).rejects.toThrow("no OCR result for job job-empty-pdf in batch output");
	});

	it("throws if Audio batch output has no transcript text or segments", async () => {
		const emptyResultLine: MistralBatchResultLine = {
			custom_id: "job-empty-audio",
			response: {
				body: { text: "", segments: [] },
			},
		};

		const job: JobForBuild = {
			file_key: "uploads/empty.mp3",
			sha256: "0000",
			title: null,
			modality: "audio",
		};

		await expect(
			buildDocumentAndDocx(job, "job-empty-audio", emptyResultLine),
		).rejects.toThrow(
			"no audio transcript for job job-empty-audio in batch output",
		);
	});
});
