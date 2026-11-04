import { describe, expect, it } from "vitest";
import type { SavedContentSource } from "@/types/schemas/contentEvidence";
import type { ContentDraftOutput } from "@/types/schemas/contentDraft";
import { assembleContentDraft } from "./contentDraftAssembly";

const EVIDENCE = "Sencha is steamed for about 30 seconds after picking.";
const PRICE = "The Basic plan costs 20 dollars per month.";
const source = (
  id: string,
  sourceText: string,
  kind: SavedContentSource["kind"] = "pasted",
): SavedContentSource => ({
  id,
  projectId: "project",
  kind,
  title: id,
  attribution: id,
  sourceText,
  textHash: id,
  capturedAtMs: 1,
  publisherDate: null,
  language: null,
  market: null,
  extractionMethod: "owner_paste",
  extractionVersion: "1",
  extractionStatus: "usable",
  extractionReason: null,
  createdByUserId: null,
  urlCapture: null,
  auditReference: null,
});
const sources = new Map([
  ["S1", source("one", `Intro. ${EVIDENCE} ${PRICE}`)],
  ["S2", source("two", `Audit: ${PRICE}`, "audit")],
]);
const current = {
  brief: {
    target: "",
    objective: "",
    audience: "",
    outputKind: "article",
    topic: "Tea",
    locale: { language: "en", country: "US" },
  },
  metadata: { title: "", slug: "", description: "", schemaSuggestion: "" },
};
type Statement =
  ContentDraftOutput["sections"][number]["blocks"][number]["statements"][number];
const say = (
  text: string,
  citations: Statement["citations"] = [],
  overrides: Partial<Statement> = {},
): Statement => ({
  text,
  kind: "general",
  factual: citations.length > 0,
  citations,
  ...overrides,
});
const cite = (quote: string, ref = "S1") => [{ source: ref, quote }];
const assemble = (
  statements: Statement[],
  extra: Partial<ContentDraftOutput> = {},
  map: ReadonlyMap<string, SavedContentSource> = sources,
) =>
  assembleContentDraft(
    {
      title: "Green tea basics",
      description: "",
      sections: [
        { heading: "Making it", blocks: [{ format: "paragraph", statements }] },
      ],
      openQuestions: [],
      omissions: [],
      ...extra,
    },
    map,
    current,
  );

describe("assembleContentDraft", () => {
  it("records exact offsets for each claim in the body", () => {
    const draft = assemble([
      say("Worth knowing first.", [], { kind: "opinion" }),
      say("Sencha is steamed.", cite(EVIDENCE)),
    ]);
    expect(draft.markdown).toBe(
      "## Making it\n\nWorth knowing first. Sencha is steamed.",
    );
    const [claim] = draft.claims;
    if (claim.target.kind !== "markdown") throw new Error("Expected body");
    expect(draft.markdown.slice(claim.target.start, claim.target.end)).toBe(
      "Sencha is steamed.",
    );
    expect(claim.evidence[0]).toMatchObject({
      sourceId: "one",
      excerpt: EVIDENCE,
      relation: "supports",
    });
  });

  it("finds a quote whose line breaks were flattened", () => {
    const text = "Sencha is steamed\n\nfor about 30 seconds.";
    const draft = assemble(
      [
        say(
          "Sencha is steamed for about 30 seconds.",
          cite("Sencha is steamed for about 30 seconds."),
        ),
      ],
      {},
      new Map([["S1", source("one", text)]]),
    );
    expect(draft.claims[0].evidence[0].excerpt).toBe(text);
  });

  it("drops every statement it can't tie to a source", () => {
    const dropped = [
      say("Tea cures every illness.", [], { factual: true }),
      say("Our product has every feature.", [], { kind: "product" }),
      say("Plans start at 5 dollars.", [], { kind: "opinion" }),
      say("All data is encrypted at rest.", [], { kind: "opinion" }),
      say("Sencha is the oldest tea.", cite("Not in the source at all.")),
      say("Sencha is the best tea.", cite(EVIDENCE, "S9")),
      say("Sencha is great.", cite("Sencha")),
      say("Sencha is steamed for 90 seconds.", cite(EVIDENCE)),
    ];
    const draft = assemble([
      say("Sencha is steamed.", cite(EVIDENCE)),
      ...dropped,
    ]);
    expect(draft.markdown).toBe("## Making it\n\nSencha is steamed.");
    expect(draft.claims).toHaveLength(1);
    expect(draft.omissions).toHaveLength(dropped.length);
  });

  it("keeps a sourced sensitive claim, but never on an audit observation", () => {
    const kept = assemble([
      say("The Basic plan costs 20 dollars.", cite(PRICE), {
        kind: "financial",
      }),
    ]);
    expect(kept.claims[0].kind).toBe("financial");
    for (const overrides of [{ kind: "financial" as const }, {}]) {
      const audit = assemble([
        say("The Basic plan costs 20 dollars.", cite(PRICE, "S2"), overrides),
      ]);
      expect(audit.markdown).toBe("");
      expect(audit.claims).toEqual([]);
    }
  });

  it("removes links, images and block syntax, wherever they came from", () => {
    const draft = assemble(
      [
        say("Sencha is steamed.", cite(EVIDENCE)),
        say("Read more at https://attacker.example/x.", [], {
          kind: "opinion",
        }),
        say("![pixel](attacker.example/p.png)", cite(EVIDENCE)),
        say("[click](attacker.example)", [], { kind: "opinion" }),
        say("<img src=x>", [], { kind: "opinion" }),
        say("# A heading from the page", [], { kind: "opinion" }),
        say("line one\n\n# planted", [], { kind: "opinion" }),
      ],
      {
        openQuestions: ["See https://attacker.example", "Who approves this?"],
      },
    );
    expect(draft.markdown).toBe("## Making it\n\nSencha is steamed.");
    expect(draft.openQuestions).toEqual(["Who approves this?"]);
  });

  it("states no facts in the title, description or headings", () => {
    const draft = assembleContentDraft(
      {
        title: "Plans from 5 dollars",
        description: "Fully GDPR compliant.",
        sections: [
          {
            heading: "Refunds within 30 days",
            blocks: [
              {
                format: "bullets",
                statements: [say("Sencha is steamed.", cite(EVIDENCE))],
              },
            ],
          },
        ],
        openQuestions: [],
        omissions: [],
      },
      sources,
      current,
    );
    expect(draft.metadata).toMatchObject({
      title: "Tea",
      slug: "tea",
      description: "",
    });
    expect(draft.markdown).toBe("- Sencha is steamed.");
    expect(draft.omissions).toHaveLength(3);
  });

  it("drops a heading with nothing left under it", () => {
    const draft = assemble([say("Invented.", [], { factual: true })]);
    expect(draft.markdown).toBe("");
  });

  it("removes email addresses and tilde fences", () => {
    const draft = assemble(
      [
        say("Write to billing@attacker.example before you buy."),
        say("~~~"),
        say("~~~ then the rest"),
        say("Keep this line."),
      ],
      { openQuestions: ["Ask sales@attacker.example?"] },
    );
    expect(draft.markdown).toBe("## Making it\n\nKeep this line.");
    expect(draft.openQuestions).toEqual([]);
    expect(draft.omissions).toHaveLength(3);
  });
});
