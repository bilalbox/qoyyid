import {
  AlignmentType,
  Document as DocxDocument,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
  type IRunOptions,
} from "docx";
import { SUPERSCRIPT_MARK_CLOSE, SUPERSCRIPT_MARK_OPEN } from "./mistral-mapping";
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
};

const PARA_STYLE: Record<string, string> = {
  matn: "QoyyidMatn",
  sharh: "QoyyidSharh",
  hashiya: "QoyyidHashiya",
  footnote: "QoyyidFootnote",
  body: "QoyyidBody",
  paragraph: "QoyyidBody",
};

const HEADING_LEVEL: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  title: HeadingLevel.TITLE,
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  heading: HeadingLevel.HEADING_1,
};

const TYPED_ROLES = new Set([...Object.keys(HEADING_LEVEL), ...Object.keys(BLOCK_STYLE)]);

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

// Builds the TextRun(s) for a paragraph's text, splitting out any inline
// footnote references into their own superscript run.
function runsForText(text: string, styleKey: string): TextRun[] {
  const base = runOpts(styleKey);
  const segments = splitSuperscriptSegments(text);
  if (!segments.length) return [new TextRun({ ...base, text } as IRunOptions)];
  return segments.map(
    (seg) =>
      new TextRun({
        ...base,
        text: seg.text,
        superScript: seg.superScript || undefined,
        size: seg.superScript ? Math.round((base.size as number) * 0.7) : base.size,
      } as IRunOptions),
  );
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

function writeHeading(children: Paragraph[], block: Block): void {
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
        children: runsForText(text, styleKey),
      }),
    );
  }
}

function writeTypedBlock(children: Paragraph[], block: Block): void {
  if (block.type in HEADING_LEVEL) {
    writeHeading(children, block);
    return;
  }
  const styleKey = styleForBlock(block);
  const styleName = PARA_STYLE[styleKey];
  const reflowed = reflowBlock(block);
  const paragraphs = splitParagraphs(reflowed.length ? reflowed : [joinWords(block.lines.map((l) => l.text))]);
  const spec = STYLE_SPEC[styleKey] ?? STYLE_SPEC.body;
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i];
    if (!text.trim()) continue;
    children.push(
      new Paragraph({
        style: styleName,
        ...rtlProps({
          spacing:
            styleKey === "footnote" && i === 0 && spec.spaceBefore
              ? { before: spec.spaceBefore * 20 }
              : undefined,
        }),
        children: runsForText(text, styleKey),
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
  };
}

export async function documentToDocxBuffer(doc: Document): Promise<Uint8Array> {
  const children: Paragraph[] = [];

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
              text: `— ${page.index + 1} —`,
              bold: true,
              size: 44,
              color: "666666",
              rightToLeft: true,
            }),
          ],
        }),
      );
      if (hasTypedBlocks(page)) {
        for (const block of [...page.blocks].sort((a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0))) {
          writeTypedBlock(children, block);
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
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(file));
}
