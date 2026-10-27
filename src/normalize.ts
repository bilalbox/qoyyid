import {
	SUPERSCRIPT_MARK_CLOSE,
	SUPERSCRIPT_MARK_OPEN,
} from "./mistral-mapping";
import type { Block } from "./types";

const BIDI_STRIP = new Set([
	0x200e, 0x200f, 0x061c, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
	0x2067, 0x2068, 0x2069, 0x200c, 0x200d,
]);

const WS = /[ \t\u00A0]+/g;
const MULTI_NL = /\n{3,}/g;
const TATWEEL = "\u0640";

// The invisible PUA sentinels docx-export uses to mark inline footnote-
// reference spans. They're stripped from the flat `text`/`text_normalized`
// (what search / plain-text consumers read), but deliberately LEFT in the
// block lines: docx-export reads them back to rebuild real Word footnotes on
// the admin "reproduce docx" path, which runs against the stored blocks.
const SUPERSCRIPT_MARKS = new RegExp(
	`[${SUPERSCRIPT_MARK_OPEN}${SUPERSCRIPT_MARK_CLOSE}]`,
	"g",
);

export function safeNormalize(text: string): string {
	if (!text) return "";
	let out = text.normalize("NFKC");
	out = [...out].filter((ch) => !BIDI_STRIP.has(ch.charCodeAt(0))).join("");
	out = out.replaceAll(TATWEEL, "");
	out = out.replace(SUPERSCRIPT_MARKS, "");
	out = out.replace(WS, " ");
	out = out
		.split("\n")
		.map((l) => l.trim())
		.join("\n");
	out = out.replace(MULTI_NL, "\n\n");
	return out.trim();
}

export function rebuildFlatText(pages: { blocks: Block[] }[]): string {
	const parts: string[] = [];
	for (const page of pages) {
		const blocks = [...page.blocks].sort(
			(a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0),
		);
		for (const block of blocks) {
			const t = block.lines
				.map((l) => l.text)
				.join("\n")
				.replace(SUPERSCRIPT_MARKS, "")
				.trim();
			if (t) parts.push(t);
		}
	}
	return parts.join("\n\n");
}

export function normalizeDocument(doc: {
	pages?: { blocks: Block[] }[];
	text?: string;
	text_normalized?: string;
}): void {
	const pages = doc.pages ?? [];
	doc.text = rebuildFlatText(pages);
	doc.text_normalized = safeNormalize(doc.text);
}
