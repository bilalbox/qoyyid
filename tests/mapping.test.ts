import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MistralOcrPage } from "../src/mistral";
import {
	digitsToInt,
	mapMistralAudioToQoyyidPage,
	mapMistralPageToQoyyidPage,
	SUPERSCRIPT_MARK_CLOSE,
	SUPERSCRIPT_MARK_OPEN,
	stripRunningHeaders,
} from "../src/mistral-mapping";
import { normalizeDocument, safeNormalize } from "../src/normalize";
import type { Document } from "../src/types";

describe("digitsToInt", () => {
	it("parses ASCII digits", () => {
		expect(digitsToInt("123")).toBe(123);
	});

	it("parses Arabic-Indic digits", () => {
		expect(digitsToInt("١٦٦")).toBe(166);
		expect(digitsToInt("٢٨٦")).toBe(286);
	});
});

describe("mapMistralPageToQoyyidPage", () => {
	it("maps OCR blocks fixture into a Qoyyid page with footnotes and page label", () => {
		const fixturePath = resolve(
			__dirname,
			"../fixtures/mistral/ocr-blocks-page.json",
		);
		const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
		const ocrPage: MistralOcrPage = raw.pages[0];

		const mapped = mapMistralPageToQoyyidPage(ocrPage);
		stripRunningHeaders([mapped]);
		const { page } = mapped;

		expect(page.index).toBe(0);
		// Printed page number preserved as label from header "١٦٦"
		expect(page.label).toBe("١٦٦");

		// Header block is dropped from page blocks
		expect(page.blocks.some((b) => (b.type as string) === "header")).toBe(
			false,
		);

		// Footnotes extracted and separated: (1), (2), (3)
		const footnotes = page.blocks.filter((b) => b.type === "footnote");
		expect(footnotes.length).toBe(3);
		expect(footnotes[0]?.lines[0]?.text).toContain("(١) وهو مأخوذ من (السهو)");
		expect(footnotes[1]?.lines[0]?.text).toContain("(٢) أخرجه البخاري");
		expect(footnotes[2]?.lines[0]?.text).toContain("(٣) ينظر المسألة");

		// Footnote inline references in body text have PUA sentinels injected
		const textWithRef = page.blocks.find((b) =>
			b.lines[0]?.text.includes(SUPERSCRIPT_MARK_OPEN),
		);
		expect(textWithRef).toBeDefined();
		expect(textWithRef?.lines[0]?.text).toContain(
			`${SUPERSCRIPT_MARK_OPEN}(١)${SUPERSCRIPT_MARK_CLOSE}`,
		);

		// Long paragraph starting with "قوله" (>12 words) remains body
		const longLemmaBlock = page.blocks.find((b) =>
			b.lines[0]?.text.includes("قوله: «وَالسَّاهِي"),
		);
		expect(longLemmaBlock).toBeDefined();
		expect(longLemmaBlock?.type).toBe("body");
	});

	it("promotes short lexical headings (<= 12 words) to heading", () => {
		const pageWithShortHeading: MistralOcrPage = {
			index: 0,
			markdown: "",
			header: null,
			footer: null,
			dimensions: { dpi: 200, height: 1000, width: 800 },
			blocks: [
				{
					top_left_x: 100,
					top_left_y: 100,
					bottom_right_x: 700,
					bottom_right_y: 200,
					type: "text",
					content: "باب في بيان شروط التكليف",
				},
				{
					top_left_x: 100,
					top_left_y: 250,
					bottom_right_x: 700,
					bottom_right_y: 350,
					type: "text",
					content: "قوله: «والساهي والصبي والمجنون»",
				},
			],
		};

		const { page } = mapMistralPageToQoyyidPage(pageWithShortHeading);
		expect(page.blocks[0]?.type).toBe("heading");
		expect(page.blocks[0]?.lines[0]?.text).toBe("باب في بيان شروط التكليف");
		expect(page.blocks[1]?.type).toBe("heading");
		expect(page.blocks[1]?.lines[0]?.text).toBe(
			"قوله: «والساهي والصبي والمجنون»",
		);
	});
});

describe("mapMistralAudioToQoyyidPage", () => {
	it("maps single-segment audio fixture to a Qoyyid page", () => {
		const fixturePath = resolve(
			__dirname,
			"../fixtures/mistral/audio-segments.json",
		);
		const raw = JSON.parse(readFileSync(fixturePath, "utf8"));

		const mapped = mapMistralAudioToQoyyidPage(raw);
		expect(mapped.page.index).toBe(0);
		expect(mapped.page.blocks.length).toBeGreaterThan(0);
		expect(mapped.page.blocks[0]?.lines[0]?.text).toBe(
			"بسم الله الرحمن الرحيم",
		);
	});

	it("classifies multi-speaker lesson turns into sharh and qari/question roles", () => {
		const multiTurnBody = {
			text: "",
			segments: [
				{
					speaker_id: "shaykh",
					text: "الحمد لله رب العالمين، أما بعد فيقول المصنف رحمه الله تعالى",
					start: 0,
					end: 10,
					type: "transcription_segment" as const,
				},
				{
					speaker_id: "qari",
					text: "قال المصنف رحمه الله: باب شروط الصلاة",
					start: 11,
					end: 20,
					type: "transcription_segment" as const,
				},
				{
					speaker_id: "shaykh",
					text: "هذا الباب عقده المصنف لبيان شروط صحة الصلاة",
					start: 21,
					end: 40,
					type: "transcription_segment" as const,
				},
			],
		};

		const mapped = mapMistralAudioToQoyyidPage(multiTurnBody);
		expect(mapped.page.blocks.length).toBeGreaterThanOrEqual(3);
		// Qari turns become matn
		const matnBlock = mapped.page.blocks.find((b) => b.type === "matn");
		expect(matnBlock).toBeDefined();
		expect(matnBlock?.lines[0]?.text).toContain("باب شروط الصلاة");
	});
});

describe("safeNormalize & normalizeDocument", () => {
	it("strips Tatweel and Bidi characters from text", () => {
		// Arabic text with Tatweel (ـ) and Bidi mark (U+200F)
		const dirty = "\u200Fكتـــاب\u200E";
		expect(safeNormalize(dirty)).toBe("كتاب");
	});

	it("strips PUA footnote superscript markers during normalization", () => {
		const withPUA = `نص الشرح ${SUPERSCRIPT_MARK_OPEN}(١)${SUPERSCRIPT_MARK_CLOSE} تتمة النص`;
		expect(safeNormalize(withPUA)).toBe("نص الشرح (١) تتمة النص");
	});

	it("populates document.text and document.text_normalized across pages", () => {
		const doc: Document = {
			pages: [
				{
					index: 0,
					blocks: [
						{
							type: "heading",
							reading_order: 0,
							lines: [{ text: "فصــــل" }],
						},
						{
							type: "body",
							reading_order: 1,
							lines: [
								{
									text: `الحكم الأول ${SUPERSCRIPT_MARK_OPEN}(١)${SUPERSCRIPT_MARK_CLOSE}`,
								},
							],
						},
					],
				},
			],
		};

		normalizeDocument(doc);
		expect(doc.text).toBe("فصــــل\n\nالحكم الأول (١)");
		expect(doc.text_normalized).toBe("فصل\n\nالحكم الأول (١)");
	});
});
