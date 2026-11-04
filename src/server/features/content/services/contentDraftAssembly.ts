import {
  CONTENT_CLAIM_LIMIT,
  type ContentClaimInput,
  type SavedContentSource,
} from "@/types/schemas/contentEvidence";
import type { ContentDraftOutput } from "@/types/schemas/contentDraft";
import type { ContentBrief, ContentMetadata } from "@/types/schemas/content";
import {
  checkUncitedText,
  contradictsQuote,
  isEnglishLanguage,
  numbersMatchQuote,
  readsAsEnglish,
  sensitiveKindOf,
  usesLatinScript,
  wordingMatchesQuote,
} from "./contentDraftTextChecks";

const SENSITIVE_KINDS = ["product", "security", "financial", "legal"];
const MIN_QUOTE_LENGTH = 15;
const LIST_LIMIT = 100;
const NOTE_LENGTH = 300;
const HAND_CHECK_NOTE =
  "The automatic checks only read English. Check this draft by hand, including its title, headings and any text with no source.";

// Links, email addresses, images, raw HTML and block syntax can't reach the
// draft, so a source can't plant a tracker or a link through the text it
// influenced, or turn the rest of the page into a code block.
const MARKUP =
  /[<>]|\]\s*[([:]|!\[|https?:\/\/|www\.|\S@\S|```|~~~|^\s*(?:[#>*+|`-]|\d+[.)]\s)/imu;

const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
const plainText = (value: string) => {
  const text = normalize(value);
  return text && !MARKUP.test(value) ? text : "";
};

function findPassage(source: string, rawQuote: string) {
  const quote = rawQuote.trim();
  if (quote.length < MIN_QUOTE_LENGTH) return null;
  const exact = source.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  // Extraction keeps line breaks that a copied quote often flattens.
  const pattern = quote
    .split(/\s+/u)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("\\s+");
  const match = new RegExp(pattern, "u").exec(source);
  return match
    ? { start: match.index, end: match.index + match[0].length }
    : null;
}

type Statement =
  ContentDraftOutput["sections"][number]["blocks"][number]["statements"][number];

export function assembleContentDraft(
  output: ContentDraftOutput,
  sources: ReadonlyMap<string, SavedContentSource>,
  current: { brief: ContentBrief; metadata: ContentMetadata },
) {
  const left: string[] = [];
  const leaveOut = (reason: string, text: string) => {
    const note = normalize(text).slice(0, NOTE_LENGTH);
    if (note) left.push(`${reason}: ${note}`);
  };
  type Kept = {
    text: string;
    claim: Omit<ContentClaimInput, "target" | "text"> | null;
  };
  let claimCount = 0;
  let needsHandCheck = false;
  const draftIsEnglish = isEnglishLanguage(current.brief.locale.language);
  const uncitedSafe = (value: string) => {
    const text = plainText(value);
    if (!text) return "";
    const verdict = checkUncitedText(text, draftIsEnglish);
    if (verdict === "needs_source") return "";
    if (verdict === "check_by_hand") needsHandCheck = true;
    return text;
  };

  const keep = (statement: Statement): Kept | null => {
    const text = plainText(statement.text);
    if (!text) {
      leaveOut("Left out, contains links or markup", statement.text);
      return null;
    }
    if (!statement.citations.length) {
      if (statement.factual || SENSITIVE_KINDS.includes(statement.kind)) {
        leaveOut("Left out, no source", text);
        return null;
      }
      const verdict = checkUncitedText(text, draftIsEnglish);
      if (verdict === "needs_source") {
        leaveOut("Left out, needs a source", text);
        return null;
      }
      if (verdict === "safe") return { text, claim: null };
      // The checks can't read this, so it becomes a claim with no evidence,
      // which a reviewer has to assess before approving.
      if (claimCount >= CONTENT_CLAIM_LIMIT) {
        leaveOut("Left out, too many claims for one revision", text);
        return null;
      }
      claimCount += 1;
      needsHandCheck = true;
      return {
        text,
        claim: { kind: "general", factual: true, evidence: [] },
      };
    }
    // A statement's own label can raise how strict review is, never lower it.
    const kind = SENSITIVE_KINDS.includes(statement.kind)
      ? statement.kind
      : (sensitiveKindOf(text) ?? "general");
    const sensitive = SENSITIVE_KINDS.includes(kind);
    let foreignSource = false;
    const seen = new Set<string>();
    const evidence = statement.citations.flatMap((citation) => {
      const source = sources.get(citation.source);
      // An audit observation can't support a sensitive claim.
      if (!source || (sensitive && source.kind === "audit")) return [];
      const passage = findPassage(source.sourceText, citation.quote);
      if (!passage) return [];
      if (source.language && !isEnglishLanguage(source.language))
        foreignSource = true;
      const key = `${citation.source}:${passage.start}:${passage.end}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          sourceId: source.id,
          ...passage,
          excerpt: source.sourceText.slice(passage.start, passage.end),
          relation: "supports" as const,
        },
      ];
    });
    if (!evidence.length) {
      leaveOut("Left out, its source could not be confirmed", text);
      return null;
    }
    const cited = evidence.map((entry) => entry.excerpt).join(" ");
    // Word checks need one language on both sides. Text that can't be compared
    // stays as a claim and the draft is flagged for a closer look.
    const comparesWords = draftIsEnglish && usesLatinScript(text);
    const readable = comparesWords && !foreignSource && readsAsEnglish(cited);
    // Each passage counts: one that denies the statement can't sit beside one
    // that agrees and be shown as support. A quote too short to read as English
    // can still deny it, so this doesn't wait for `readable`.
    if (
      comparesWords &&
      evidence.some((entry) => contradictsQuote(text, entry.excerpt))
    ) {
      leaveOut("Left out, its source says the opposite", text);
      return null;
    }
    // A number has to appear in the passage that is meant to support it.
    if (!numbersMatchQuote(text, cited, readable)) {
      leaveOut("Left out, its numbers are not in the source", text);
      return null;
    }
    if (readable && !wordingMatchesQuote(text, cited)) {
      leaveOut("Left out, its source does not say this", text);
      return null;
    }
    if (claimCount >= CONTENT_CLAIM_LIMIT) {
      leaveOut("Left out, too many claims for one revision", text);
      return null;
    }
    claimCount += 1;
    if (!readable) needsHandCheck = true;
    return { text, claim: { kind, factual: true, evidence } };
  };

  let markdown = "";
  const claims: ContentClaimInput[] = [];
  const write = ({ text, claim }: Kept) => {
    if (claim)
      claims.push({
        ...claim,
        text,
        target: {
          kind: "markdown",
          start: markdown.length,
          end: markdown.length + text.length,
        },
      });
    markdown += text;
  };
  for (const section of output.sections) {
    const blocks = section.blocks.flatMap((block) => {
      const kept = block.statements.flatMap((statement) => {
        const result = keep(statement);
        return result ? [result] : [];
      });
      return kept.length ? [{ format: block.format, kept }] : [];
    });
    // A heading with nothing left under it would promise missing content.
    if (!blocks.length) continue;
    const heading = uncitedSafe(section.heading);
    if (section.heading.trim() && !heading)
      leaveOut("Heading left out, needs a source", section.heading);
    if (heading) markdown += `## ${heading}\n\n`;
    for (const { format, kept } of blocks) {
      kept.forEach((statement, index) => {
        if (format === "bullets") markdown += "- ";
        else if (index > 0) markdown += " ";
        write(statement);
        if (format === "bullets") markdown += "\n";
      });
      markdown += format === "bullets" ? "\n" : "\n\n";
    }
  }

  const title = uncitedSafe(output.title);
  if (output.title.trim() && !title)
    leaveOut("Title left out, needs a source", output.title);
  const description = uncitedSafe(output.description);
  if (output.description.trim() && !description)
    leaveOut("Description left out, needs a source", output.description);
  const finalTitle = title || current.metadata.title || current.brief.topic;
  return {
    markdown: markdown.trimEnd(),
    metadata: {
      title: finalTitle,
      slug: current.metadata.slug || slugFor(finalTitle),
      description: description || current.metadata.description,
      schemaSuggestion: current.metadata.schemaSuggestion,
    },
    claims,
    openQuestions: [
      ...(needsHandCheck ? [HAND_CHECK_NOTE] : []),
      ...output.openQuestions.flatMap((question) => plainText(question) || []),
    ].slice(0, LIST_LIMIT),
    omissions: [
      ...output.omissions.flatMap((omission) => plainText(omission) || []),
      ...left,
    ].slice(0, LIST_LIMIT),
  };
}

const slugFor = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
