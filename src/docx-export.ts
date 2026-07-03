import {
  AlignmentType,
  Document as DocxDocument,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
} from "docx";
import { digitsToInt, SUPERSCRIPT_MARK_CLOSE, SUPERSCRIPT_MARK_OPEN } from "./mistral-mapping";
import type { Block, Document, Line, Page } from "./types";

const GAP_RATIO = 1.35;
const ARABIC_FONT = "Traditional Arabic";

const STYLE_SPEC: Record<string, { size: number; bold?: boolean; color?: string; spaceBefore?: number }> = {
  title: { size: 40, bold: true },
  h1: { size: 36, bold: true, spaceBefore: 24 },
  h2: { size: 32, bold: true, spaceBefore: 20 },
  h3: { size: 30, bold: true, spaceBefore: 16 },
  heading: { size: 36, bold: true, spaceBefore: 24 },
  matn: { size: 32 },
  sharh: { size: 28 },
  hashiya: { size: 24, color: "555555" },
  footnote: { size: 20, color: "777777", spaceBefore: 16 },
  body: { size: 28 },
  paragraph: { size: 28 },
  question: { size: 28 },
  answer: { size: 28 },
  // Text of a real Word footnote (bottom of page) — smaller like `footnote`,
  // but normal ink: the grey of the legacy pseudo-footnote paragraphs is for
  // telling them apart from body text, which real footnotes don't need.
  footnoteText: { size: 20 },
};

const BLOCK_STYLE: Record<string, string> = {
  title: "title",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  heading: "heading",
  matn: "matn",
  sharh: "sharh",
  hashiya: "hashiya",
  footnote: "footnote",
  body: "body",
  paragraph: "paragraph",
  question: "question",
  answer: "answer",
};

// Bold lead-in marking a turn in the question session of a lecture (dars).
const QA_LEAD_IN: Record<string, string> = {
  question: "س: ",
  answer: "ج: ",
};

const PARA_STYLE: Record<string, string> = {
  matn: "QoyyidMatn",
  sharh: "QoyyidSharh",
  hashiya: "QoyyidHashiya",
  footnote: "QoyyidFootnote",
  body: "QoyyidBody",
  paragraph: "QoyyidBody",
  question: "QoyyidBody",
  answer: "QoyyidBody",
};

// Character style for Qur'anic quotations (spans wrapped in ﴾…﴿ ornate
// brackets, which Mistral OCR preserves) — a named style so the whole
// register can be restyled in Word in one place.
const QURAN_CHAR_STYLE = "QoyyidQuran";

const HEADING_LEVEL: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  title: HeadingLevel.TITLE,
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  heading: HeadingLevel.HEADING_1,
};

const TYPED_ROLES = new Set([...Object.keys(HEADING_LEVEL), ...Object.keys(BLOCK_STYLE), "table"]);

function joinWords(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(" ");
}

function lineHeight(line: Line): number {
  if (line.bbox && line.bbox.length >= 4) {
    return Math.max(1, line.bbox[3] - line.bbox[1]);
  }
  return 12;
}

function reflowLines(lines: Line[]): string[] {
  const usable = lines.filter((l) => l.text.trim());
  if (!usable.length) return [];
  if (!usable.some((l) => l.bbox)) {
    return [joinWords(usable.map((l) => l.text))];
  }
  const ordered = [...usable].sort((a, b) => {
    const ay = a.bbox?.[1] ?? 0;
    const by = b.bbox?.[1] ?? 0;
    const ax = a.bbox?.[0] ?? 0;
    const bx = b.bbox?.[0] ?? 0;
    return ay - by || bx - ax;
  });
  const paragraphs: string[] = [];
  let bucket: string[] = [];
  let prevBottom: number | null = null;
  let refH = lineHeight(ordered[0]);
  for (const line of ordered) {
    const text = line.text.trim();
    const h = lineHeight(line);
    refH = Math.max(refH, h);
    if (line.bbox && prevBottom !== null) {
      const gap = line.bbox[1] - prevBottom;
      if (gap > refH * GAP_RATIO && bucket.length) {
        paragraphs.push(joinWords(bucket));
        bucket = [];
      }
    }
    bucket.push(text);
    if (line.bbox) prevBottom = line.bbox[3];
  }
  if (bucket.length) paragraphs.push(joinWords(bucket));
  return paragraphs;
}

function reflowBlock(block: Block): string[] {
  return reflowLines(block.lines);
}

function reflowPage(page: Page): string[] {
  const paragraphs: string[] = [];
  const blocks = [...page.blocks].sort((a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0));
  for (const block of blocks) {
    const parts = reflowBlock(block);
    if (!parts.length) continue;
    if (paragraphs.length && parts.length === 1 && block.lines.length <= 2) {
      if (parts[0].length < 48) {
        paragraphs.push(parts[0]);
        continue;
      }
    }
    paragraphs.push(...parts);
  }
  return paragraphs;
}

function hasTypedBlocks(page: Page): boolean {
  return page.blocks.some(
    (b) => TYPED_ROLES.has(b.type) && b.lines.some((l) => l.text.trim()),
  );
}

function styleForBlock(block: Block): string {
  return BLOCK_STYLE[block.type] ?? "body";
}

function splitParagraphs(texts: string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const part of text.split("\n")) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function paragraphStyleHeuristic(text: string): string {
  const s = text.trim();
  if (s.length < 55 && /[:؟،]$/.test(s)) return "heading";
  return "body";
}

function runOpts(styleKey: string): IRunOptions {
  const spec = STYLE_SPEC[styleKey] ?? STYLE_SPEC.body;
  return {
    font: ARABIC_FONT,
    size: spec.size * 2,
    bold: spec.bold,
    color: spec.color,
    rightToLeft: true,
  };
}

const SUPERSCRIPT_SPLIT_RE = new RegExp(
  `${SUPERSCRIPT_MARK_OPEN}([^${SUPERSCRIPT_MARK_CLOSE}]*)${SUPERSCRIPT_MARK_CLOSE}`,
  "g",
);

// Splits paragraph text around the PUA sentinels left by mistral-mapping's
// markInlineFootnoteMarkup, so an inline footnote reference like "(٣)" can be
// emitted as its own raised, smaller run instead of full-size inline text.
function splitSuperscriptSegments(text: string): Array<{ text: string; superScript: boolean }> {
  const segments: Array<{ text: string; superScript: boolean }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(SUPERSCRIPT_SPLIT_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ text: text.slice(lastIndex, index), superScript: false });
    segments.push({ text: match[1], superScript: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), superScript: false });
  return segments.filter((s) => s.text.length > 0);
}

// A Qur'anic quotation span, ornate brackets inclusive: ﴾…﴿ (OCR preserves
// them; note the brackets arrive in visual order, closing bracket ﴿ first in
// the logical string is possible — accept either orientation).
const QURAN_SPAN_RE = /[﴾﴿][^﴾﴿]*[﴾﴿]/g;

// Splits normal (non-superscript) text into plain runs and Qur'an-styled runs.
function splitQuranRuns(text: string, base: IRunOptions): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const m of text.matchAll(QURAN_SPAN_RE)) {
    const i = m.index ?? 0;
    if (i > last) runs.push(new TextRun({ ...base, text: text.slice(last, i) } as IRunOptions));
    runs.push(new TextRun({ ...base, text: m[0], style: QURAN_CHAR_STYLE } as IRunOptions));
    last = i + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun({ ...base, text: text.slice(last) } as IRunOptions));
  return runs;
}

/** Resolves a page-local footnote number (e.g. ٣) to its document-global
 *  Word footnote id, when that footnote was converted to a real footnote. */
export type FootnoteRefResolver = (num: number) => number | undefined;

const REF_NUM_RE = /^\(([0-9]+|[٠-٩]+)\)$/;

function refNumOf(text: string): number | undefined {
  const m = text.match(REF_NUM_RE);
  return m ? digitsToInt(m[1]) : undefined;
}

// Builds the run(s) for a paragraph's text: inline footnote references become
// real Word footnote references when resolvable (falling back to a raised
// superscript run), and Qur'anic ﴾…﴿ spans get the QoyyidQuran character
// style.
function runsForText(
  text: string,
  styleKey: string,
  resolveRef?: FootnoteRefResolver,
): Array<TextRun | FootnoteReferenceRun> {
  const base = runOpts(styleKey);
  const segments = splitSuperscriptSegments(text);
  if (!segments.length) return splitQuranRuns(text, base);
  const runs: Array<TextRun | FootnoteReferenceRun> = [];
  for (const seg of segments) {
    if (!seg.superScript) {
      runs.push(...splitQuranRuns(seg.text, base));
      continue;
    }
    const num = refNumOf(seg.text);
    const footnoteId = num !== undefined && resolveRef ? resolveRef(num) : undefined;
    if (footnoteId !== undefined) {
      runs.push(new FootnoteReferenceRun(footnoteId));
    } else {
      runs.push(
        new TextRun({
          ...base,
          text: seg.text,
          superScript: true,
          size: Math.round((base.size as number) * 0.7),
        } as IRunOptions),
      );
    }
  }
  return runs;
}

function rtlProps(extra?: { spacing?: { before?: number } }): {
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
  bidirectional: boolean;
  spacing?: { before?: number };
} {
  return {
    // AlignmentType.RIGHT ("right") is a *physical* value — with bidi text
    // Word doesn't reliably render it flush to the visual right, it can come
    // out flush left despite the RTL paragraph direction. AlignmentType.START
    // ("start") is logical: it means the reading-direction start edge, which
    // for an RTL paragraph is the visual right — the actual intent here.
    alignment: AlignmentType.START,
    bidirectional: true,
    ...extra,
  };
}

function centeredRtlProps(extra?: { spacing?: { before?: number } }): {
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
  bidirectional: boolean;
  spacing?: { before?: number };
} {
  return {
    alignment: AlignmentType.CENTER,
    bidirectional: true,
    ...extra,
  };
}

function writeHeading(
  children: Array<Paragraph | Table>,
  block: Block,
  resolveRef?: FootnoteRefResolver,
): void {
  const styleKey = styleForBlock(block);
  const texts = splitParagraphs([joinWords(block.lines.map((l) => l.text))]);
  const spec = STYLE_SPEC[styleKey] ?? STYLE_SPEC.heading;
  const heading = HEADING_LEVEL[block.type] ?? HeadingLevel.HEADING_1;
  for (const text of texts) {
    if (!text.trim()) continue;
    children.push(
      new Paragraph({
        heading,
        ...centeredRtlProps({ spacing: spec.spaceBefore ? { before: spec.spaceBefore * 20 } : undefined }),
        // A footnote referenced from a heading is still consumed into a real
        // Word footnote by collectPageFootnotes, so the heading must emit its
        // reference run too — otherwise the note has no anchor and vanishes.
        children: runsForText(text, styleKey, resolveRef),
      }),
    );
  }
}

// A markdown table separator row like |---|:---:|.
const TABLE_SEPARATOR_RE = /^[\s|:\-–—]+$/;

// Renders a `table` block (lines = raw markdown table rows) as a real RTL
// docx table. Falls back to plain paragraphs when no row parses.
function writeTableBlock(children: Array<Paragraph | Table>, block: Block): void {
  const rows: TableRow[] = [];
  for (const line of block.lines) {
    const raw = line.text.trim();
    if (!raw || TABLE_SEPARATOR_RE.test(raw)) continue;
    const cells = raw.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (!cells.some(Boolean)) continue;
    rows.push(
      new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ ...rtlProps(), children: runsForText(cell, "body") })],
            }),
        ),
      }),
    );
  }
  if (!rows.length) {
    for (const line of block.lines) {
      if (!line.text.trim()) continue;
      children.push(new Paragraph({ style: PARA_STYLE.body, ...rtlProps(), children: runsForText(line.text, "body") }));
    }
    return;
  }
  children.push(
    new Table({
      rows,
      visuallyRightToLeft: true,
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  );
}

function writeTypedBlock(
  children: Array<Paragraph | Table>,
  block: Block,
  resolveRef?: FootnoteRefResolver,
): void {
  if (block.type in HEADING_LEVEL) {
    writeHeading(children, block, resolveRef);
    return;
  }
  if (block.type === "table") {
    writeTableBlock(children, block);
    return;
  }
  const styleKey = styleForBlock(block);
  const styleName = PARA_STYLE[styleKey];
  const leadIn = QA_LEAD_IN[block.type];
  const reflowed = reflowBlock(block);
  const paragraphs = splitParagraphs(reflowed.length ? reflowed : [joinWords(block.lines.map((l) => l.text))]);
  const spec = STYLE_SPEC[styleKey] ?? STYLE_SPEC.body;
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i];
    if (!text.trim()) continue;
    const runs = runsForText(text, styleKey, resolveRef);
    if (leadIn && i === 0) {
      runs.unshift(new TextRun({ ...runOpts(styleKey), text: leadIn, bold: true } as IRunOptions));
    }
    children.push(
      new Paragraph({
        style: styleName,
        ...rtlProps({
          spacing:
            styleKey === "footnote" && i === 0 && spec.spaceBefore
              ? { before: spec.spaceBefore * 20 }
              : undefined,
        }),
        children: runs,
      }),
    );
  }
}

function buildCustomStyles(): NonNullable<NonNullable<ConstructorParameters<typeof DocxDocument>[0]>["styles"]> {
  const seen = new Set<string>();
  const paragraphStyles: Array<{
    id: string;
    name: string;
    basedOn: string;
    run: { font: string; size: number; bold?: boolean; color?: string; rightToLeft: boolean };
    paragraph: { alignment: (typeof AlignmentType)[keyof typeof AlignmentType] };
  }> = [];
  for (const [key, name] of Object.entries(PARA_STYLE)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const spec = STYLE_SPEC[key] ?? STYLE_SPEC.body;
    paragraphStyles.push({
      id: name,
      name,
      basedOn: "Normal",
      run: {
        font: ARABIC_FONT,
        size: spec.size * 2,
        bold: spec.bold,
        color: spec.color,
        rightToLeft: true,
      },
      paragraph: { alignment: AlignmentType.START },
    });
  }
  return {
    default: {
      document: {
        run: { font: ARABIC_FONT, size: 56, rightToLeft: true },
        paragraph: { alignment: AlignmentType.START },
      },
    },
    paragraphStyles,
    characterStyles: [
      {
        id: QURAN_CHAR_STYLE,
        name: "Qoyyid Quran",
        run: { bold: true, rightToLeft: true },
      },
    ],
  };
}

// Leading "(N)" entry marker of a footnote block's text.
const FOOTNOTE_LEAD_RE = /^\(([0-9]+|[٠-٩]+)\)\s*/;

interface PageFootnotes {
  resolveRef: FootnoteRefResolver;
  /** Footnote blocks lifted into real Word footnotes — skipped in the body. */
  consumed: Set<Block>;
}

/**
 * Converts a page's referenced footnote blocks into real Word footnotes.
 * Only entries whose number is actually referenced inline on the same page
 * are lifted (an unreferenced entry would otherwise vanish — Word renders a
 * footnote only where a reference run exists); the rest keep the legacy
 * end-of-page rendering. Word renumbers references sequentially document-wide,
 * so the original per-page (١)(٢)… markers are dropped from the note text.
 */
function collectPageFootnotes(
  page: Page,
  footnotes: Record<string, { children: Paragraph[] }>,
  nextId: () => number,
): PageFootnotes {
  // Nothing to lift — skip the whole-page reference scan below when the page
  // carries no footnote entries at all (the common case for body-only pages).
  if (!page.blocks.some((b) => b.type === "footnote")) {
    return { resolveRef: () => undefined, consumed: new Set() };
  }

  const referenced = new Set<number>();
  for (const block of page.blocks) {
    if (block.type === "footnote" || block.type === "table") continue;
    for (const line of block.lines) {
      for (const seg of splitSuperscriptSegments(line.text)) {
        if (!seg.superScript) continue;
        const num = refNumOf(seg.text);
        if (num !== undefined) referenced.add(num);
      }
    }
  }

  const idByNum = new Map<number, number>();
  const consumed = new Set<Block>();
  for (const block of page.blocks) {
    if (block.type !== "footnote") continue;
    const text = block.lines.map((l) => l.text).join(" ").trim();
    const m = text.match(FOOTNOTE_LEAD_RE);
    if (!m) continue;
    const num = digitsToInt(m[1]);
    if (!referenced.has(num) || idByNum.has(num)) continue;
    const id = nextId();
    idByNum.set(num, id);
    consumed.add(block);
    footnotes[id] = {
      children: [
        new Paragraph({
          ...rtlProps(),
          children: runsForText(text.slice(m[0].length), "footnoteText"),
        }),
      ],
    };
  }

  return { resolveRef: (num) => idByNum.get(num), consumed };
}

export async function documentToDocxBuffer(doc: Document): Promise<Uint8Array> {
  const children: Array<Paragraph | Table> = [];
  const footnotes: Record<string, { children: Paragraph[] }> = {};
  let footnoteCounter = 0;
  const nextFootnoteId = () => ++footnoteCounter;

  if (doc.pages?.length) {
    const pages = [...doc.pages].sort((a, b) => a.index - b.index);
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      const page = pages[i];
      children.push(
        new Paragraph({
          ...rtlProps(),
          children: [
            new TextRun({
              text: `— ${page.label ?? page.index + 1} —`,
              bold: true,
              size: 44,
              color: "666666",
              rightToLeft: true,
            }),
          ],
        }),
      );
      if (hasTypedBlocks(page)) {
        const pageFootnotes = collectPageFootnotes(page, footnotes, nextFootnoteId);
        for (const block of [...page.blocks].sort((a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0))) {
          if (pageFootnotes.consumed.has(block)) continue;
          writeTypedBlock(children, block, pageFootnotes.resolveRef);
        }
      } else {
        for (const text of reflowPage(page)) {
          const style = paragraphStyleHeuristic(text);
          children.push(
            new Paragraph({
              ...(style === "heading" ? centeredRtlProps() : rtlProps()),
              children: [
                new TextRun({
                  text,
                  ...runOpts(style),
                  ...(style === "heading" ? { bold: true, size: 64 } : {}),
                } as IRunOptions),
              ],
            }),
          );
        }
      }
    }
  } else {
    const text = (doc.text_normalized || doc.text || "").trim();
    if (text) {
      children.push(
        new Paragraph({
          ...rtlProps(),
          children: runsForText(text, "body"),
        }),
      );
    }
  }

  const file = new DocxDocument({
    styles: buildCustomStyles(),
    footnotes: Object.keys(footnotes).length ? footnotes : undefined,
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(file));
}
