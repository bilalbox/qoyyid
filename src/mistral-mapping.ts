import type { Block, BlockType, Page } from "./types";
import type { MistralOcrPage } from "./mistral";

/**
 * Maps Mistral OCR 4 page output into qoyyid's Document/Page/Block schema
 * (src/types.ts).
 *
 * Confirmed against a real batch result (2026-07-01): Mistral OCR 4 does NOT
 * return a `blocks`/bbox array — a page is just `{ index, markdown,
 * dimensions, images, tables, hyperlinks, header, footer }`, with header/
 * footer unpopulated in practice. So structure has to come from parsing the
 * markdown text itself (blank-line paragraphs, `#`/`##` headings, `(N)`
 * footnote paragraphs) rather than page-geometry heuristics.
 *
 * The matn/sharh/hashiya (main text/commentary/marginalia) block types and
 * the lexical heading-promotion keyword lists below (KEYWORDS,
 * LEMMA_PREFIXES, symbolHit/lemmaHit) are ported from a prior Python-based
 * Surya-OCR pipeline for the same classical Arabic manuscript OCR use case,
 * which had per-line bounding boxes and used geometry (bbox position/width)
 * to classify these zones. This API gives no bbox, so that geometry-based
 * classification is gone — only the text-only lexical-heading heuristic
 * survived the port, since it never depended on bbox.
 */

const HEADING_TYPES = new Set<string>(["title", "h1", "h2", "h3", "heading"]);

// --- lexical heading promotion --
// Text-only signal, so it still works without bbox — kept as-is.

const KEYWORDS = new Set([
  "باب", "فصل", "مبحث", "مطلب", "مسألة", "مسئلة", "مقدمة", "خاتمة",
  "فائدة", "تنبيه", "فرع", "ركن", "كتاب", "القسم", "مجلس",
]);
const LEMMA_PREFIXES = ["قوله", "وقوله", "فقوله"];

function stripDiacritics(word: string): string {
  return [...word].filter((ch) => !(ch >= "ً" && ch <= "ْ") && ch !== "ـ").join("");
}

function hasDigit(text: string): boolean {
  return [...text].some((ch) => (ch >= "0" && ch <= "9") || (ch >= "٠" && ch <= "٩"));
}

function keywordHit(words: string[]): boolean {
  return words.slice(0, 2).some((w) => KEYWORDS.has(stripDiacritics(w.replace(/^[().،:]+|[().،:]+$/g, ""))));
}

function symbolHit(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("[") && !hasDigit(text)) return true;
  return ["﴾", "﴿", "۞"].some((s) => text.includes(s)); // ﴾ ﴿ ۞
}

function lemmaHit(words: string[]): boolean {
  if (!words.length) return false;
  const first = stripDiacritics(words[0].replace(/^[«».،:]+|[«».،:]+$/g, ""));
  return LEMMA_PREFIXES.some((p) => first.startsWith(p));
}

function isLexicalHeading(text: string): boolean {
  const stripped = text.trim();
  if (stripped.replace(/\s+/g, "").length < 6) return false;
  const words = stripped.split(/\s+/);
  return keywordHit(words) || symbolHit(stripped) || lemmaHit(words);
}

const SURYA_PRESERVE_TYPES = new Set<string>(["footnote"]);

function promoteLexicalHeadings(blocks: Block[]): void {
  for (const block of blocks) {
    if (HEADING_TYPES.has(block.type) || SURYA_PRESERVE_TYPES.has(block.type)) continue;
    if (!["body", "paragraph", "sharh", "matn"].includes(block.type)) continue;
    const text = block.lines[0]?.text ?? "";
    if (isLexicalHeading(text) && text.split(/\s+/).length <= 12) {
      block.type = "heading";
      block.level = undefined;
    }
  }
}

// --- markdown parsing (replaces geometry classification — see file header) --

// A markdown heading: 1-6 leading '#' followed by whitespace.
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
// A footnote entry: starts with a parenthesized number, Latin or Arabic-Indic
// digits (e.g. "(1)" or "(١)") — Mistral gives no other structural signal
// separating footnotes from body text (no rule/divider survives into markdown).
const FOOTNOTE_RE = /^\(([0-9]+|[٠-٩]+)\)/;
// An inline footnote reference the way Mistral renders it mid-sentence,
// e.g. "...word$^{(٣)}$ more text" — LaTeX superscript wrapping a plain
// parenthesized number. There's no real math here, so we drop the literal
// "$^{}$" wrapper but keep the "(٣)" wrapped in a pair of Private Use Area
// sentinel characters, which downstream renderers (docx-export) use to know
// this span should be typeset as an actual raised superscript rather than
// full-size inline text. Plain-text consumers of block text (doc.text_normalized)
// never see these sentinels — they're invisible/non-printing PUA codepoints
// and get treated as ordinary characters if left un-stripped, but docx-export
// always consumes them before output reaches a user.
export const SUPERSCRIPT_MARK_OPEN = "";
export const SUPERSCRIPT_MARK_CLOSE = "";
const INLINE_FOOTNOTE_REF_RE = /\$\^\{(\([0-9٠-٩]+\))\}\$/g;

function markInlineFootnoteMarkup(text: string): string {
  return text.replace(INLINE_FOOTNOTE_REF_RE, `${SUPERSCRIPT_MARK_OPEN}$1${SUPERSCRIPT_MARK_CLOSE}`);
}
// A paragraph that is only digits/dashes/dots/whitespace — a bare page number
// or ruler artifact, not real content (the merge step already inserts its own
// page-boundary marker, so these would just duplicate it as noise).
const PAGE_NUMBER_ONLY_RE = /^[\s0-9٠-٩\-–—.]+$/;

function splitMarkdownParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n+/)
    .map((p) => markInlineFootnoteMarkup(p.replace(/\s*\n\s*/g, " ").trim()))
    .filter(Boolean);
}

interface ClassifiedParagraph {
  type: BlockType;
  text: string;
  level?: number;
}

function classifyMarkdownParagraph(raw: string): ClassifiedParagraph | null {
  const heading = raw.match(HEADING_RE);
  if (heading) {
    const level = Math.min(heading[1].length, 3);
    return { type: `h${level}` as BlockType, text: heading[2].trim(), level };
  }
  if (PAGE_NUMBER_ONLY_RE.test(raw)) return null;
  if (FOOTNOTE_RE.test(raw)) return { type: "footnote" as BlockType, text: raw };
  return { type: "body" as BlockType, text: raw };
}

// --- running-header candidates (book title / section header repeated on
// alternating recto/verso pages, per classical Arabic printing convention —
// e.g. sample.pdf page 1 has no title line before its page number, page 2
// does). Detected per-page here (signal A: short + adjacent to a dropped
// page-number paragraph), resolved document-wide in merge.ts (signal B:
// cross-page repetition), which is the higher-confidence signal and takes
// priority whenever it finds anything — see stripRunningHeaders there.

const HEADER_CANDIDATE_MAX_WORDS = 8;

export interface HeaderCandidate {
  pageIndex: number;
  readingOrder: number;
  text: string;
}

function isHeaderCandidateText(text: string): boolean {
  if (HEADING_RE.test(text) || FOOTNOTE_RE.test(text) || PAGE_NUMBER_ONLY_RE.test(text)) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= HEADER_CANDIDATE_MAX_WORDS;
}

export interface MappedPage {
  page: Page;
  headerCandidates: HeaderCandidate[];
}

function buildBlocks(raw: string[]): Block[] {
  const blocks: Block[] = [];
  let order = 0;
  for (const text of raw) {
    const classified = classifyMarkdownParagraph(text);
    if (!classified) continue;
    blocks.push({
      type: classified.type,
      reading_order: order++,
      bbox: null,
      level: classified.level,
      lines: [{ text: classified.text }],
    });
  }
  return blocks;
}

// Only consider the first couple of paragraphs on the page — a running
// header lives at the very top, never mid-body.
function findHeaderCandidates(raw: string[], pageIndex: number): HeaderCandidate[] {
  const headerCandidates: HeaderCandidate[] = [];
  let order = 0;
  for (let i = 0; i < raw.length; i++) {
    const text = raw[i];
    const classified = classifyMarkdownParagraph(text);
    if (!classified) continue;

    const readingOrder = order++;
    if (classified.type === "body" && i <= 1 && isHeaderCandidateText(text)) {
      const prevIsPageNum = i > 0 && PAGE_NUMBER_ONLY_RE.test(raw[i - 1]);
      const nextIsPageNum = i + 1 < raw.length && PAGE_NUMBER_ONLY_RE.test(raw[i + 1]);
      if (prevIsPageNum || nextIsPageNum) {
        headerCandidates.push({ pageIndex, readingOrder, text: text.trim() });
      }
    }
  }
  return headerCandidates;
}

export function mapMistralPageToQoyyidPage(mistralPage: MistralOcrPage): MappedPage {
  const pageW = mistralPage.dimensions?.width ?? 0;
  const pageH = mistralPage.dimensions?.height ?? 0;
  const raw = splitMarkdownParagraphs(mistralPage.markdown ?? "");

  const blocks = buildBlocks(raw);
  const headerCandidates = findHeaderCandidates(raw, mistralPage.index);

  const page: Page = { index: mistralPage.index, width: pageW, height: pageH, blocks };
  promoteLexicalHeadings(page.blocks);
  return { page, headerCandidates };
}

function normalizeForMatch(text: string): string {
  return stripDiacritics(text.trim()).replace(/\s+/g, " ");
}

/**
 * Resolves running-header candidates across an entire document (call once
 * all pages are mapped). Signal B (repetition) takes priority: any candidate
 * text that recurs on 2+ pages is dropped as a confirmed running header.
 * Signal A (the per-page positional heuristic alone) is only trusted as a
 * fallback when B finds nothing repeated anywhere in the document — e.g. a
 * short job where a real running header only appears once so far.
 */
export function stripRunningHeaders(mapped: MappedPage[]): void {
  const allCandidates = mapped.flatMap((m) => m.headerCandidates);
  if (!allCandidates.length) return;

  const groups = new Map<string, HeaderCandidate[]>();
  for (const c of allCandidates) {
    const key = normalizeForMatch(c.text);
    const group = groups.get(key) ?? [];
    group.push(c);
    groups.set(key, group);
  }

  const repeated = [...groups.values()].filter((g) => g.length >= 2).flat();
  const toDrop = repeated.length > 0 ? repeated : allCandidates;

  const dropByPage = new Map<number, Set<number>>();
  for (const c of toDrop) {
    const set = dropByPage.get(c.pageIndex) ?? new Set<number>();
    set.add(c.readingOrder);
    dropByPage.set(c.pageIndex, set);
  }

  for (const { page } of mapped) {
    const drop = dropByPage.get(page.index);
    if (!drop) continue;
    page.blocks = page.blocks.filter((b) => !drop.has(b.reading_order ?? -1));
  }
}

export function mapMistralAudioToQoyyidPage(text: string): MappedPage {
  const raw = splitMarkdownParagraphs(text);
  const blocks = buildBlocks(raw);

  const page: Page = { index: 0, width: 0, height: 0, blocks };
  promoteLexicalHeadings(page.blocks);
  return { page, headerCandidates: [] };
}
