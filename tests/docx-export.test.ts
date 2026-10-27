import { describe, expect, it } from "vitest";
import { documentToDocxBuffer } from "../src/docx-export";
import {
	SUPERSCRIPT_MARK_CLOSE,
	SUPERSCRIPT_MARK_OPEN,
} from "../src/mistral-mapping";
import type { Document } from "../src/types";

describe("documentToDocxBuffer", () => {
	it("generates a valid DOCX buffer from a text-only fallback document", async () => {
		const doc: Document = {
			text: "نص تجريبي مجرد بدون صفحات",
		};

		const buf = await documentToDocxBuffer(doc);
		expect(buf).toBeInstanceOf(Uint8Array);
		expect(buf.length).toBeGreaterThan(500);
		// Zip header check
		expect(buf[0]).toBe(0x50);
		expect(buf[1]).toBe(0x4b);
		expect(buf[2]).toBe(0x03);
		expect(buf[3]).toBe(0x04);
	});

	it("generates DOCX with footnotes, headings, tables, and page markers", async () => {
		const doc: Document = {
			metadata: { title: "كتاب الطهارة" },
			pages: [
				{
					index: 0,
					label: "١",
					blocks: [
						{
							type: "title",
							reading_order: 0,
							lines: [{ text: "كتاب الطهارة" }],
						},
						{
							type: "h1",
							reading_order: 1,
							lines: [{ text: "باب المياه" }],
						},
						{
							type: "body",
							reading_order: 2,
							lines: [
								{
									text: `المياه على ثلاثة أقسام ${SUPERSCRIPT_MARK_OPEN}(١)${SUPERSCRIPT_MARK_CLOSE} طهور وطاهر ونجس.`,
								},
							],
						},
						{
							type: "footnote",
							reading_order: 3,
							lines: [{ text: "(١) هذا المذهب عند الحنابلة." }],
						},
						{
							type: "table",
							reading_order: 4,
							lines: [
								{ text: "| القسم | الحكم |" },
								{ text: "| --- | --- |" },
								{ text: "| طهور | يرفع الحدث |" },
								{ text: "| طاهر | لا يرفع الحدث |" },
							],
						},
					],
				},
				{
					index: 1,
					label: "٢",
					blocks: [
						{
							type: "body",
							reading_order: 0,
							lines: [{ text: "تتمة الكلام في المياه." }],
						},
					],
				},
			],
		};

		const buf = await documentToDocxBuffer(doc);
		expect(buf).toBeInstanceOf(Uint8Array);
		expect(buf.length).toBeGreaterThan(1500);
		expect(buf[0]).toBe(0x50);
		expect(buf[1]).toBe(0x4b);
	});
});
