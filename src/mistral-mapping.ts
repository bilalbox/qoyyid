import type { Block, BlockType, Page } from "./types";
import type { MistralAudioSegment, MistralOcrBlock, MistralOcrPage } from "./mistral";

/**
 * Maps Mistral OCR 4 page output into qoyyid's Document/Page/Block schema
 * (src/types.ts).
 *
 * Two OCR paths:
 *  - Block path (jobs submitted with `include_blocks`/`extract_header`/
 *    `extract_footer`, 2026-07-03+): typed blocks with pixel bboxes drive
 *    classification — `references` → footnote, `aside_text` → hashiya,
 *    `title` → heading, header/footer dropped (their text is already removed
 *    from markdown by the API). matn vs sharh is resolved document-wide from
 *    text density (chars per bbox area — larger print = lower density) in
 *    classifyMatnSharh, restoring what the prior Surya pipeline did with
 *    per-line geometry.
 *  - Legacy markdown path: older stored mistral_response.json lines have no
 *    blocks (confirmed 2026-07-01), so structure comes from parsing markdown
 *    (blank-line paragraphs, `#` headings, `(N)` footnote paragraphs) and the
 *    running-header heuristics below. Kept so admin "reproduce" on old jobs
 *    still works; note the docx output for old jobs is intentionally NOT
 *    byte-stable — reproduce picks up rendering upgrades (e.g. real Word
 *    footnotes) as they land.
 *
 * The lexical heading-promotion keyword lists (KEYWORDS, LEMMA_PREFIXES,
 * symbolHit/lemmaHit) are ported from the prior Python/Surya pipeline and
 * apply to both paths.
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
// Exported so docx-export matches footnote entries with the same grammar.
export const FOOTNOTE_RE = /^\(([0-9]+|[٠-٩]+)\)/;
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

// A markdown image placeholder like ![img-2.jpeg](img-2.jpeg). Mistral OCR
// emits these for regions it renders as images — decorative headings/marginalia
// it can't read as glyphs, or actual figures — but we neither embed nor keep the
// image (include_image_base64 is off), so the placeholder is pure noise in every
// downstream consumer (docx, search, flat text). Stripped at ingestion so it
// never reaches the stored blocks.
const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\([^)]*\)/g;

function stripImageMarkdown(text: string): string {
  return text.replace(IMAGE_MARKDOWN_RE, "");
}

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
  /** Text density (chars per bbox area) of each body-typed block — input to
   *  the document-wide matn/sharh split in classifyMatnSharh. Holds the Block
   *  reference directly so later passes that filter or retype blocks can't
   *  detach a density from its block. Only populated by the block path. */
  bodyDensities?: Array<{ block: Block; density: number }>;
}

function buildBlocks(raw: string[]): Block[] {
  const blocks: Block[] = [];
  let order = 0;
  for (const text of raw) {
    const classified = classifyMarkdownParagraph(text);
    if (!classified) continue;
    if (classified.type === "footnote") {
      // A footnote paragraph can hold several concatenated "(N) …" entries
      // (Mistral concatenates them without newlines) — one block per entry so
      // docx-export can pair each with its own inline reference.
      for (const entry of splitFootnoteEntries(classified.text)) {
        blocks.push({ type: "footnote", reading_order: order++, bbox: null, lines: [{ text: entry }] });
      }
      continue;
    }
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
  if (mistralPage.blocks?.length) return mapFromOcrBlocks(mistralPage);

  const pageW = mistralPage.dimensions?.width ?? 0;
  const pageH = mistralPage.dimensions?.height ?? 0;
  const raw = splitMarkdownParagraphs(stripImageMarkdown(mistralPage.markdown ?? ""));

  const blocks = buildBlocks(raw);
  const headerCandidates = findHeaderCandidates(raw, mistralPage.index);

  const page: Page = { index: mistralPage.index, width: pageW, height: pageH, blocks };
  promoteLexicalHeadings(page.blocks);
  return { page, headerCandidates };
}

// --- block path (include_blocks responses, 2026-07-03+) --

// A printed folio number in a running header/footer: digits only, possibly
// decorated with dashes/brackets/dots, e.g. "١٦٦" or "- 12 -" (decoration
// class kept a superset of PAGE_NUMBER_ONLY_RE's so the two page-number
// notions can't disagree on the same string).
const PAGE_LABEL_RE = /^[\s\-–—.[\]()]*([0-9٠-٩]+)[\s\-–—.[\]()]*$/;

const ARABIC_INDIC_ZERO = "٠".charCodeAt(0);

export function digitsToInt(s: string): number {
  let out = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    const d = code >= ARABIC_INDIC_ZERO ? code - ARABIC_INDIC_ZERO : code - 48;
    out = out * 10 + d;
  }
  return out;
}

// Heading level for a `title` block, from the classical division hierarchy:
// كتاب (book) above باب (chapter) above فصل/مسألة/مبحث… (section).
const H1_WORDS = new Set(["كتاب", "القسم"]);
const H2_WORDS = new Set(["باب", "مقدمة", "خاتمة", "مجلس"]);

function headingLevelFor(text: string): number {
  const first = stripDiacritics(text.trim().split(/\s+/)[0] ?? "").replace(/^[«»().،:]+|[«»().،:]+$/g, "");
  if (H1_WORDS.has(first)) return 1;
  if (H2_WORDS.has(first)) return 2;
  if (KEYWORDS.has(first)) return 3;
  return 2;
}

function bboxOf(b: MistralOcrBlock): number[] {
  return [b.top_left_x, b.top_left_y, b.bottom_right_x, b.bottom_right_y];
}

// A bare inline "(N)" footnote reference (the block path's markdown uses
// plain parens, not the $^{(N)}$ LaTeX shape), not already wrapped in PUA
// sentinels by markInlineFootnoteMarkup.
const PLAIN_REF_RE = new RegExp(
  `(?<!${SUPERSCRIPT_MARK_OPEN})\\(([0-9]{1,3}|[٠-٩]{1,3})\\)(?!${SUPERSCRIPT_MARK_CLOSE})`,
  "g",
);

// Marks bare inline "(N)" footnote references — but only numbers that
// actually have a matching footnote entry on the same page, so citation
// parens like "(ص ٢٢٢)" or "(١/ ١٤٤)" stay untouched.
function markPlainInlineFootnoteRefs(text: string, footnoteNums: Set<number>): string {
  if (!footnoteNums.size) return text;
  return text.replace(PLAIN_REF_RE, (whole, num: string) =>
    footnoteNums.has(digitsToInt(num)) ? `${SUPERSCRIPT_MARK_OPEN}${whole}${SUPERSCRIPT_MARK_CLOSE}` : whole,
  );
}

// A footnote entry boundary *inside* running text: "(N)" after entry-ending
// punctuation (period/question/quote/bracket, or a closing citation paren —
// muhaqqiq entries often end "…(٢/ ٣٤١)" with no period). Confirmed against a
// real references block (2026-07-03): Mistral can concatenate consecutive
// entries into one content string with no newline.
const INLINE_ENTRY_BOUNDARY_RE = /(?<=[.!؟»،؛)\]])\s+(?=\((?:[0-9]{1,3}|[٠-٩]{1,3})\)\s)/g;

// Splits a references block into individual footnote entries. A new entry
// starts at a line leading with "(N)", or mid-line after sentence-ending
// punctuation — but mid-line only when N is exactly the previous entry's
// number + 1, so quoted parenthesized numbers can't fragment an entry.
function splitFootnoteEntries(content: string): string[] {
  const lineEntries: string[] = [];
  for (const line of content.split("\n")) {
    const text = line.trim();
    if (!text) continue;
    if (FOOTNOTE_RE.test(text) || !lineEntries.length) {
      lineEntries.push(text);
    } else {
      lineEntries[lineEntries.length - 1] += ` ${text}`;
    }
  }

  const entries: string[] = [];
  for (const entry of lineEntries) {
    let lastNum = digitsToInt(entry.match(FOOTNOTE_RE)?.[1] ?? "0");
    let current = "";
    for (const piece of entry.split(INLINE_ENTRY_BOUNDARY_RE)) {
      const m = piece.match(FOOTNOTE_RE);
      if (current && m && digitsToInt(m[1]) === lastNum + 1) {
        entries.push(current.trim());
        current = piece;
        lastNum += 1;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
    if (current.trim()) entries.push(current.trim());
  }
  return entries.map((e) => markInlineFootnoteMarkup(e));
}

function mapFromOcrBlocks(mistralPage: MistralOcrPage): MappedPage {
  const pageW = mistralPage.dimensions?.width ?? 0;
  const pageH = mistralPage.dimensions?.height ?? 0;

  // Header takes precedence: when both carry digits, the footer is more
  // often a quire/juz mark while the folio number runs in the header.
  let label: string | undefined;
  for (const furniture of [mistralPage.header, mistralPage.footer]) {
    const m = furniture?.match(PAGE_LABEL_RE);
    if (m) {
      label = m[1];
      break;
    }
  }

  const blocks: Block[] = [];
  const bodyDensities: Array<{ block: Block; density: number }> = [];
  let order = 0;

  for (const src of mistralPage.blocks ?? []) {
    // Strip image placeholders before the empty check: an `image`-type block, or
    // a text/title block whose content was only a placeholder, then drops out
    // here instead of becoming a stray empty (or noise) block.
    const content = stripImageMarkdown(src.content ?? "").trim();
    if (!content) continue;
    const bbox = bboxOf(src);
    const confidence = src.confidence ?? src.average_content_confidence_score;
    const makeBlock = (type: BlockType, textLines: string[], level?: number | null): Block => ({
      type,
      reading_order: order++,
      bbox,
      confidence,
      level,
      lines: textLines.map((text) => ({ text, confidence })),
    });

    switch (src.type) {
      case "header":
      case "footer":
        // Already isolated out of markdown by extract_header/extract_footer;
        // page number captured via the header/footer fields above.
        break;
      case "image":
      case "signature":
        break;
      case "table":
        blocks.push(
          makeBlock(
            "table",
            content.split("\n").map((text) => text.trim()).filter(Boolean),
          ),
        );
        break;
      case "references":
        // Footnote zone; may hold several "(N) …" entries — one Block each so
        // docx-export can match them to their inline references individually.
        for (const entry of splitFootnoteEntries(content)) {
          blocks.push(makeBlock("footnote", [entry]));
        }
        break;
      case "aside_text":
        for (const para of splitMarkdownParagraphs(content)) {
          blocks.push(makeBlock("hashiya", [para]));
        }
        break;
      case "title": {
        const text = content.replace(HEADING_RE, "$2").trim();
        const level = headingLevelFor(text);
        blocks.push(makeBlock(`h${level}` as BlockType, [text], level));
        break;
      }
      default: {
        // text / list / caption / code / equation / unknown → paragraphs.
        const area = Math.max(1, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
        const density = content.replace(/\s+/g, "").length / area;
        for (const para of splitMarkdownParagraphs(content)) {
          const classified = classifyMarkdownParagraph(para);
          if (!classified) continue;
          // On the block path Mistral already isolates footnotes into
          // `references` blocks, so a "(N) …"-leading paragraph inside a
          // text block is body content (an enumerated item, a quoted entry) —
          // never let the legacy footnote check lift it out of the flow.
          const type = classified.type === "footnote" ? "body" : classified.type;
          const block = makeBlock(type, [classified.text], classified.level);
          if (type === "body") bodyDensities.push({ block, density });
          blocks.push(block);
        }
      }
    }
  }

  // Link bare inline "(N)" references to this page's footnote entries.
  const footnoteNums = new Set<number>();
  for (const b of blocks) {
    if (b.type !== "footnote") continue;
    const m = b.lines[0]?.text.match(FOOTNOTE_RE);
    if (m) footnoteNums.add(digitsToInt(m[1]));
  }
  for (const b of blocks) {
    if (b.type === "footnote" || b.type === "table") continue;
    for (const line of b.lines) {
      line.text = markPlainInlineFootnoteRefs(line.text, footnoteNums);
    }
  }

  const page: Page = { index: mistralPage.index, width: pageW, height: pageH, label, blocks };
  promoteLexicalHeadings(page.blocks);
  return { page, headerCandidates: [], bodyDensities };
}

/**
 * Document-wide matn/sharh split (call once all pages are mapped, block path
 * only). In printed sharh editions the matn is set in visibly larger type
 * than the commentary, so its text density (chars per bbox area) is markedly
 * lower. A 2-means split over log-densities of all body blocks decides
 * whether the document has two registers at all: only when the dense cluster
 * is ≥ MIN_SEPARATION× denser and both clusters are non-trivially populated
 * do body blocks get relabeled matn (sparse) / sharh (dense) — a single-
 * register book stays "body" untouched.
 */
export function classifyMatnSharh(mapped: MappedPage[]): void {
  const MIN_SEPARATION = 1.6;
  const MIN_CLUSTER_SHARE = 0.05;

  const samples: Array<{ block: Block; logDensity: number }> = [];
  for (const m of mapped) {
    for (const { block, density } of m.bodyDensities ?? []) {
      // Blocks retyped since sampling (e.g. promoted to headings by
      // promoteLexicalHeadings) would skew the clusters with their large-type
      // densities — only still-body blocks participate.
      if (block.type === "body" && density > 0) {
        samples.push({ block, logDensity: Math.log(density) });
      }
    }
  }
  if (samples.length < 4) return;

  const values = samples.map((s) => s.logDensity).sort((a, b) => a - b);
  let lo = values[0];
  let hi = values[values.length - 1];
  if (hi - lo < 1e-9) return;
  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const low = values.filter((v) => v <= mid);
    const high = values.filter((v) => v > mid);
    if (!low.length || !high.length) break;
    const nextLo = low.reduce((a, b) => a + b, 0) / low.length;
    const nextHi = high.reduce((a, b) => a + b, 0) / high.length;
    if (Math.abs(nextLo - lo) < 1e-6 && Math.abs(nextHi - hi) < 1e-6) break;
    lo = nextLo;
    hi = nextHi;
  }

  if (Math.exp(hi - lo) < MIN_SEPARATION) return;
  const threshold = (lo + hi) / 2;
  const sparseShare = values.filter((v) => v <= threshold).length / values.length;
  if (sparseShare < MIN_CLUSTER_SHARE || sparseShare > 1 - MIN_CLUSTER_SHARE) return;

  for (const s of samples) {
    s.block.type = s.logDensity <= threshold ? "matn" : "sharh";
  }
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

// --- audio (Voxtral) --

/** One speaker turn: consecutive same-speaker segments with < TURN_GAP_SECONDS
 *  of silence between them, joined into a paragraph. */
interface AudioTurn {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

const TURN_GAP_SECONDS = 2.0;

function buildTurns(segments: MistralAudioSegment[]): AudioTurn[] {
  const turns: AudioTurn[] = [];
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const speaker = seg.speaker_id ?? "speaker_1";
    const prev = turns[turns.length - 1];
    if (prev && prev.speaker === speaker && seg.start - prev.end < TURN_GAP_SECONDS) {
      prev.text = `${prev.text} ${text}`;
      prev.end = seg.end;
    } else {
      turns.push({ speaker, text, start: seg.start, end: seg.end });
    }
  }
  return turns;
}

// A turn where the qari' (reader) picks up the matn — the fixed formula that
// opens a reading in a dars: «قال المؤلف/المصنف/الإمام… رحمه الله». Not
// anchored: the qari' commonly opens with a basmala or greeting before the
// formula, so it's searched within the start of the turn instead.
const QARI_CUE_RE = /و?ف?قال\s+(المؤلف|المصنف|الإمام|الناظم|الشيخ|صاحب|رحمه)/;
const QARI_CUE_WINDOW_CHARS = 200;

// The canonical frame of a recorded dars: opening praise formulas, the
// «أما بعد» pivot into the lesson body, then a question session.
const INTRO_OPEN_RE = /^(بسم الله|الحمد لله|إن الحمد لله|السلام عليكم)/;
const AMMA_BAD_RE = /أما بعد/;

function speakerRoles(turns: AudioTurn[]): Map<string, "shaykh" | "qari" | "other"> {
  const durations = new Map<string, number>();
  for (const t of turns) {
    durations.set(t.speaker, (durations.get(t.speaker) ?? 0) + (t.end - t.start));
  }
  const shaykh = [...durations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const roles = new Map<string, "shaykh" | "qari" | "other">();
  for (const speaker of durations.keys()) {
    roles.set(speaker, speaker === shaykh ? "shaykh" : "other");
  }
  for (const t of turns) {
    if (
      roles.get(t.speaker) === "other" &&
      QARI_CUE_RE.test(stripDiacritics(t.text.slice(0, QARI_CUE_WINDOW_CHARS)))
    ) {
      roles.set(t.speaker, "qari");
    }
  }
  return roles;
}

function headingBlock(text: string, order: number): Block {
  return { type: "h2", reading_order: order, bbox: null, level: 2, lines: [{ text }] };
}

/**
 * Maps a Voxtral transcription into a single qoyyid page.
 *
 * With diarized segments (jobs submitted with timestamp_granularities,
 * 2026-07-03+), turns become paragraphs and the standard dars format drives
 * structure: dominant-duration speaker is the shaykh (commentary → sharh), a
 * secondary speaker opening with «قال المؤلف…» is the qari' reading the matn
 * (→ matn), remaining speakers are questioners (→ question, with the
 * shaykh's following turn → answer). Section headings (المقدمة / الدرس /
 * الأسئلة) are inserted where the canonical frame is detected. Roles apply
 * only when 2+ speakers were diarized — a single-mic recording stays plain
 * body text.
 *
 * Without segments (older stored responses), falls back to markdown
 * paragraph splitting of the flat transcript.
 */
export function mapMistralAudioToQoyyidPage(body: {
  text?: string;
  segments?: MistralAudioSegment[] | null;
}): MappedPage {
  const segments = body.segments ?? [];
  if (segments.length < 2) {
    // A single diarized segment still carries the whole transcript — never
    // drop it just because the flat `text` field is empty or missing.
    const text = body.text?.trim() ? body.text : segments.map((s) => s.text).join("\n\n");
    const raw = splitMarkdownParagraphs(text);
    const blocks = buildBlocks(raw);
    const page: Page = { index: 0, width: 0, height: 0, blocks };
    promoteLexicalHeadings(page.blocks);
    return { page, headerCandidates: [] };
  }

  const turns = buildTurns(segments);
  const roles = speakerRoles(turns);
  const multiSpeaker = roles.size >= 2;

  const types: BlockType[] = turns.map((turn, i) => {
    if (!multiSpeaker) return "body";
    const role = roles.get(turn.speaker);
    if (role === "qari") return "matn";
    if (role === "other") return "question";
    const prev = turns[i - 1];
    if (prev && roles.get(prev.speaker) === "other") return "answer";
    return "sharh";
  });

  // Canonical dars frame → section headings, inserted at turn boundaries.
  const strippedFirst = stripDiacritics(turns[0]?.text ?? "");
  const ammaIdx = turns.findIndex((t, i) => i < 6 && AMMA_BAD_RE.test(stripDiacritics(t.text)));
  const hasIntro = INTRO_OPEN_RE.test(strippedFirst) && ammaIdx >= 0 && ammaIdx + 1 < turns.length;
  const firstQuestionIdx = types.indexOf("question");
  const questionsStartIdx = firstQuestionIdx > turns.length / 2 ? firstQuestionIdx : -1;

  const blocks: Block[] = [];
  let order = 0;
  for (let i = 0; i < turns.length; i++) {
    if (hasIntro && i === 0) blocks.push(headingBlock("المقدمة", order++));
    if (hasIntro && i === ammaIdx + 1) blocks.push(headingBlock("الدرس", order++));
    if (i === questionsStartIdx) blocks.push(headingBlock("الأسئلة", order++));
    blocks.push({
      type: types[i],
      reading_order: order++,
      bbox: null,
      lines: [{ text: turns[i].text }],
    });
  }

  const page: Page = { index: 0, width: 0, height: 0, blocks };
  // Single-speaker recordings have no role structure, but spoken section
  // announcements (باب/فصل…) should still become headings, as the flat-text
  // path always did.
  if (!multiSpeaker) promoteLexicalHeadings(page.blocks);
  return { page, headerCandidates: [] };
}
