import { describe, expect, it } from "vitest";
import type { SavedContentSource } from "@/types/schemas/contentEvidence";
import type { ContentDraftOutput } from "@/types/schemas/contentDraft";
import { assembleContentDraft } from "./contentDraftAssembly";

const source = (id: string, sourceText: string): SavedContentSource => ({
  id,
  projectId: "project",
  kind: "pasted",
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
const sources = new Map([["S1", source("one", "Tea is a drink.")]]);
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
const cite = (quote: string) => [{ source: "S1", quote }];
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

describe("numbers in a cited statement", () => {
  const FACTS =
    "Refunds are available within 30 days of purchase. The Pro plan costs $100 per month. Acme signed 1,500 customers, or 12.50% of the market, in 2021.";
  const facts = new Map([["S1", source("one", FACTS)]]);
  const refund = "Refunds are available within 30 days of purchase.";
  const plan = "The Pro plan costs $100 per month.";
  const signed = "Acme signed 1,500 customers, or 12.50% of the market";
  const kept = (text: string, quote: string) =>
    assemble([say(text, cite(quote))], {}, facts).markdown.includes(text);

  it.each([
    ["Refunds are available within 3 days of purchase.", refund],
    ["The Pro plan costs $1 per month.", plan],
    ["The Pro plan costs $10 per month.", plan],
    ["The Pro plan costs €100 per month.", plan],
    ["Acme has 30 million customers.", refund],
    ["Acme has 30 customers within days of purchase.", refund],
    ["Thirty million customers made a purchase within days.", refund],
    ["Refunds are available within three days of purchase.", refund],
    ["Acme signed 150 customers of the market.", signed],
    ["Acme signed 12.5 percent of the customers in 5 markets.", signed],
  ])("drops a changed number: %s", (text, quote) => {
    expect(kept(text, quote)).toBe(false);
  });

  it.each([
    ["Refunds are available within 30 days of purchase.", refund],
    ["Refunds are available within thirty days of purchase.", refund],
    ["A refund is available for 30 days after a purchase.", refund],
    ["A 30-day window applies to every refund purchase.", refund],
    ["The Pro plan costs 100 dollars per month.", plan],
    ["The Pro plan costs $100.00 per month.", plan],
    ["The Pro plan costs １００ dollars per month.", plan],
    ["The Pro plan costs ١٠٠ dollars per month.", plan],
    ["Acme signed 1500 customers of the market.", signed],
    ["Acme signed 12.5 percent of the market.", signed],
  ])("keeps the same number written differently: %s", (text, quote) => {
    expect(kept(text, quote)).toBe(true);
  });

  it("doesn't need the word after a year to be in the quote", () => {
    const quote =
      "Acme signed 1,500 customers, or 12.50% of the market, in 2021.";
    expect(kept("In 2021 Acme signed customers.", quote)).toBe(true);
    expect(kept("In 2022 Acme signed customers.", quote)).toBe(false);
  });
});

describe("a cited statement and its quote", () => {
  const FACTS =
    "Acme was founded in Oslo by two engineers. Acme is HIPAA certified and refunds any order.";
  const facts = new Map([["S1", source("one", FACTS)]]);
  const founded = "Acme was founded in Oslo by two engineers.";
  const certified = "Acme is HIPAA certified and refunds any order.";

  it.each([
    ["Acme is HIPAA certified and guarantees a full refund.", founded],
    ["Acme won a national design award.", founded],
    ["Acme is HIPAA certified.", founded],
    ["Acme encrypts data and refunds any order.", certified],
  ])("drops a statement its quote doesn't state: %s", (text, quote) => {
    const draft = assemble([say(text, cite(quote))], {}, facts);
    expect(draft.markdown).toBe("");
    expect(draft.omissions).toEqual([
      `Left out, its source does not say this: ${text}`,
    ]);
  });

  it("raises the kind from the text, whatever the model labelled it", () => {
    const kindOf = (text: string, overrides: Partial<Statement> = {}) =>
      assemble([say(text, cite(certified), overrides)], {}, facts).claims[0]
        ?.kind;
    expect(kindOf("Acme is HIPAA certified.")).toBe("legal");
    expect(kindOf("Acme is HIPAA certified.", { kind: "opinion" })).toBe(
      "legal",
    );
    expect(kindOf("Acme refunds any order.")).toBe("financial");
    expect(kindOf("Acme refunds any order.", { kind: "product" })).toBe(
      "product",
    );
    const plain = "Acme was founded in Oslo.";
    expect(
      assemble([say(plain, cite(founded))], {}, facts).claims[0].kind,
    ).toBe("general");
  });

  it("flags what it can't compare instead of dropping or passing it", () => {
    const german = new Map([
      [
        "S1",
        {
          ...source(
            "one",
            "Acme wurde von zwei Ingenieuren in Oslo gegründet.",
          ),
          language: "de",
        },
      ],
    ]);
    const draft = assemble(
      [
        say(
          "Engineers started the business in Oslo.",
          cite("Acme wurde von zwei Ingenieuren in Oslo gegründet."),
        ),
      ],
      {},
      german,
    );
    expect(draft.claims).toHaveLength(1);
    expect(draft.openQuestions[0]).toContain("Check this draft by hand");
  });
});

describe("uncited text marked as not factual", () => {
  it.each([
    "Acme is endorsed by every major hospital.",
    "Acme is the most trusted name in tea.",
    "Acme is the largest tea seller.",
    "Thirty million customers rely on Acme.",
    "Millions of people drink it daily.",
    "\u0627\u0644\u0633\u0639\u0631 \u0669\u0669 \u062f\u0648\u0644\u0627\u0631",
    "Acme serves \uff19\uff19 percent of hospitals.",
    "Plans start at \uff04 nothing.",
  ])("leaves out what needs a source: %s", (text) => {
    const draft = assemble([say(text)]);
    expect(draft.markdown).toBe("");
    expect(draft.omissions).toEqual([`Left out, needs a source: ${text}`]);
  });

  it("keeps plain advice with nothing to assess", () => {
    const draft = assemble([
      say("Start with the best way to brew it at home."),
      say("Here is what to read next."),
    ]);
    expect(draft.claims).toEqual([]);
    expect(draft.omissions).toEqual([]);
    expect(draft.openQuestions).toEqual([]);
  });

  it.each([
    "Acme ist nach Sicherheitsnorm zertifiziert und kostet nichts.",
    "\u0627\u0644\u0634\u0627\u064a \u0645\u0634\u0647\u0648\u0631 \u062c\u062f\u0627",
  ])("makes a reviewer assess text it can't read: %s", (text) => {
    const draft = assemble([say(text)]);
    expect(draft.markdown).toContain(text);
    expect(draft.claims).toEqual([
      expect.objectContaining({ text, factual: true, evidence: [] }),
    ]);
    expect(draft.openQuestions[0]).toContain("Check this draft by hand");
  });

  it("flags a whole draft whose brief isn't in English", () => {
    const draft = assembleContentDraft(
      {
        title: "Grüner Tee",
        description: "",
        sections: [
          {
            heading: "Grundlagen",
            blocks: [
              {
                format: "paragraph",
                statements: [say("Tee schmeckt gut.")],
              },
            ],
          },
        ],
        openQuestions: ["Wer prüft das?"],
        omissions: [],
      },
      sources,
      {
        ...current,
        brief: {
          ...current.brief,
          locale: { language: "de", country: "DE" },
        },
      },
    );
    expect(draft.metadata.title).toBe("Grüner Tee");
    expect(draft.markdown).toBe("## Grundlagen\n\nTee schmeckt gut.");
    expect(draft.claims).toHaveLength(1);
    expect(draft.openQuestions).toHaveLength(2);
  });
});

describe("a citation that says the opposite", () => {
  const OPPOSITE = "Left out, its source says the opposite";
  const assembleOne = (statement: string, quote: string) =>
    assemble(
      [say(statement, cite(quote))],
      {},
      new Map([["S1", source("one", quote)]]),
    );

  it.each([
    ["Acme is HIPAA certified.", "Acme is not HIPAA certified for any plan."],
    ["Acme is not HIPAA certified.", "Acme is HIPAA certified for every plan."],
    ["Acme is SOC 2 compliant.", "Acme isn't SOC 2 compliant."],
    ["Acme is SOC 2 compliant.", "Acme isn\u2019t SOC 2 compliant."],
    ["Plans include refunds.", "Plans do not include refunds or credits."],
    ["Plans include credits.", "Plans do not include refunds or credits."],
    ["Acme stores customer data.", "No customer data is ever stored by Acme."],
    ["Sencha is roasted.", "Sencha is steamed, not roasted."],
    ["Acme works with a contract.", "Acme works without a contract."],
    ["Acme is licensed.", "Acme is non-licensed in most states."],
  ])("leaves out %j cited to %j", (statement, quote) => {
    const draft = assembleOne(statement, quote);
    expect(draft.markdown).toBe("");
    expect(draft.omissions).toEqual([`${OPPOSITE}: ${statement}`]);
  });

  it.each([
    ["Acme is HIPAA certified.", "Acme is HIPAA certified for every plan."],
    ["Acme is not HIPAA certified.", "Acme is not HIPAA certified at all."],
    ["Acme does not charge fees.", "Acme charges no fees."],
    ["Acme charges no fees.", "Acme does not charge fees."],
    ["Sencha is steamed.", "Sencha is steamed, not roasted."],
    ["Sencha is steamed.", "Sencha is not roasted but steamed."],
    ["Sencha is rolled.", "Sencha is not only steamed but also rolled."],
    ["Sencha is steamed.", "Sencha is not just steamed for flavor."],
    ["Refunds arrive in days.", "Refunds arrive no later than 30 days out."],
    ["Acme is certified.", "Acme is certified. Rivals have no such plan."],
    ["Acme sells sencha.", "Not every shop does. Acme sells sencha."],
  ])("keeps %j cited to %j", (statement, quote) => {
    const draft = assembleOne(statement, quote);
    expect(draft.markdown).toContain(statement);
    expect(draft.omissions).toEqual([]);
  });

  it("leaves it out when one of several citations disagrees", () => {
    const yes = "Acme is HIPAA certified for the Pro plan.";
    const no = "Acme is not HIPAA certified for the Starter plan.";
    const draft = assemble(
      [say("Acme is HIPAA certified.", [...cite(yes), ...cite(no)])],
      {},
      new Map([["S1", source("one", `${yes} ${no}`)]]),
    );
    expect(draft.claims).toEqual([]);
    expect(draft.omissions[0]).toContain(OPPOSITE);
  });

  it("leaves text it can't read for a person, flagged by hand", () => {
    const quote = "Acme ist nicht nach HIPAA zertifiziert.";
    const draft = assembleOne("Acme ist nach HIPAA zertifiziert.", quote);
    expect(draft.omissions).toEqual([]);
    expect(draft.openQuestions[0]).toContain("Check this draft by hand");
  });
});
