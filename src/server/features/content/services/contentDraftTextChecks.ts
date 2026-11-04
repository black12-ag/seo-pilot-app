// Fixed rules for drafted text. They read numbers and English words, so they
// narrow what a reviewer has to catch and never replace that review.

const CURRENCY_MARK = "[$€£¥₹]";
const SECURITY_TERM = String.raw`encrypt\w*|security|soc ?2|iso ?27001`;
const LEGAL_TERM = String.raw`complian\w*|certifi\w*|hipaa|gdpr|pci|legal\w*|illegal|laws?|regulat\w*|licen[sc]\w*|patent\w*|liabilit\w*|guarantee[ds]?|warrant(?:y|ies)`;
const FINANCIAL_TERM = String.raw`prices?|pricing|costs?|fees?|refunds?|revenue`;
const whole = (terms: string) => new RegExp(String.raw`\b(?:${terms})\b`, "iu");

const SECURITY = whole(SECURITY_TERM);
const LEGAL = whole(LEGAL_TERM);
const FINANCIAL = new RegExp(
  String.raw`${CURRENCY_MARK}|\b(?:${FINANCIAL_TERM})\b`,
  "iu",
);
const SENSITIVE_WORD = new RegExp(
  String.raw`\b(?:${SECURITY_TERM}|${LEGAL_TERM}|${FINANCIAL_TERM})\b`,
  "giu",
);
const PRICE_WORD = /^(?:prices?|pricing|costs?|fees?)$/u;
const STATES_A_PRICE = new RegExp(
  String.raw`${CURRENCY_MARK}|\b(?:pric\w*|costs?|fees?|charges?|dollars?|euros?|pounds?|usd|eur|gbp)\b`,
  "iu",
);

// Text with no citation can't contain any of these.
const NEEDS_A_SOURCE = [
  new RegExp(String.raw`\p{Nd}|${CURRENCY_MARK}`, "u"),
  whole(
    String.raw`prices?|pricing|costs?|fees?|refunds?|discounts?|free trial|guarantee[ds]?|warrant(?:y|ies)|revenue|profits?|roi|invest\w*|encrypt\w*|secure|security|complian\w*|certifi\w*|soc ?2|iso ?27001|hipaa|gdpr|pci|legal\w*|lawful|illegal|laws?|regulat\w*|licen[sc]\w*|patent\w*|trademark\w*|liabilit\w*`,
  ),
  whole(
    "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|trillions?|dozens?",
  ),
  // Endorsements.
  whole(
    String.raw`(?:endorsed|trusted|recommended|approved|accredited|backed|chosen|preferred|used|loved|audited|verified)\s+by|award[- ]winning|proven|(?:clinically|scientifically|independently)\s+(?:tested|verified|reviewed)|every\s+major|all\s+major|(?:industry|market)[- ]leading|world[- ]class|world['’]?s|number\s+one|top[- ]rated|best[- ](?:in[- ]class|selling|rated)`,
  ),
  // Superlatives. Advice such as "the best way to start" states no fact.
  whole(
    String.raw`most\s+(?:trusted|popular|reliable|secure|accurate|advanced|affordable|widely|experienced|powerful)|largest|biggest|fastest|cheapest|safest|strongest|unmatched|unrivall?ed|unbeatable|leading(?!\s+to\b)|best(?!\s+(?:ways?|times?|practices?|approach(?:es)?|places?)\b)`,
  ),
];

const STOP_WORDS = new Set(
  "a about after all also an and any are as at be been before but by can could do does each for from had has have how if in into is it its may might more most no not of on only or other our out over per so some such than that the their them then there these they this those to up us was we were what when where which who why will with within would you your".split(
    " ",
  ),
);
// Words other languages rarely share, used only to spot text that isn't English.
const ENGLISH_WORDS = new Set(
  "about after and any are at be been before but by can could each for from has have here how if is it its just more most not of only our should some than that the their them then there these they this those to very we were what when which who why with within would you your".split(
    " ",
  ),
);

const comparable = (text: string) => text.normalize("NFKC");
const wordsOf = (text: string) => text.toLowerCase().match(/\p{L}+/gu) ?? [];
const termsOf = (text: string) =>
  wordsOf(text).filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

/** The same word apart from its ending, so "day" and "days" match. */
function sameTerm(a: string, b: string) {
  if (a === b) return true;
  const length = Math.min(5, a.length, b.length);
  return length >= 3 && a.slice(0, length) === b.slice(0, length);
}

export const isEnglishLanguage = (language: string) =>
  /^en(?:[-_]|glish|$)/iu.test(language.trim());

export const usesLatinScript = (raw: string) =>
  !/[^\P{L}\p{Script=Latin}]/u.test(comparable(raw));

export function readsAsEnglish(raw: string) {
  if (!usesLatinScript(raw)) return false;
  const words = comparable(raw).match(/\p{L}+/gu) ?? [];
  return (
    words.length < 4 ||
    words.some((word) => ENGLISH_WORDS.has(word.toLowerCase()))
  );
}

export function sensitiveKindOf(raw: string) {
  const text = comparable(raw);
  if (LEGAL.test(text)) return "legal";
  if (SECURITY.test(text)) return "security";
  if (FINANCIAL.test(text)) return "financial";
  return null;
}

export function checkUncitedText(raw: string, draftIsEnglish: boolean) {
  const text = comparable(raw);
  if (NEEDS_A_SOURCE.some((pattern) => pattern.test(text)))
    return "needs_source";
  return draftIsEnglish && readsAsEnglish(text) ? "safe" : "check_by_hand";
}

const MAGNITUDE: Record<string, number> = {
  hundred: 1e2,
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  mn: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
};
const UNIT_WORD: Record<string, string> = {
  percent: "%",
  pct: "%",
  dollar: "$",
  dollars: "$",
  usd: "$",
  euro: "€",
  euros: "€",
  eur: "€",
  pound: "£",
  pounds: "£",
  gbp: "£",
  yen: "¥",
  jpy: "¥",
  yuan: "¥",
  cny: "¥",
  rupee: "₹",
  rupees: "₹",
  inr: "₹",
};
const ONES = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
// "One" is left alone: "one of the best" and "one way" count nothing.
const SPELLED_NUMBER = new RegExp(
  String.raw`\b(?:(${TENS.join("|")})(?:[ -](${ONES.slice(0, 9).join("|")}))?|(${ONES.slice(1).join("|")}))\b`,
  "giu",
);
const NUMBER_TOKEN = new RegExp(
  String.raw`(${CURRENCY_MARK})?\s?(\d+(?:[.,]\d+)*)\s?(%|${CURRENCY_MARK})?(?:[\s-]?(\p{L}+))?(?:[\s-](\p{L}+))?`,
  "gu",
);

const isDigitAt = (codePoint: number) =>
  /\p{Nd}/u.test(String.fromCodePoint(codePoint));
/** Every decimal digit script is a run of ten, in order, starting from zero. */
function asciiDigit(char: string) {
  let codePoint = char.codePointAt(0) ?? 0;
  let value = 0;
  while (isDigitAt(codePoint - 1)) {
    codePoint -= 1;
    value += 1;
  }
  return String(value % 10);
}

function canonicalNumber(digits: string) {
  let value = digits;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(value))
    value = value.replaceAll(",", "");
  else if (/^\d{1,3}(?:\.\d{3})+,\d+$|^\d{1,3}(?:\.\d{3}){2,}$/u.test(value))
    value = value.replaceAll(".", "").replace(",", ".");
  else if (/^\d+,\d+$/u.test(value)) value = value.replace(",", ".");
  if (/^\d+\.\d+$/u.test(value)) value = value.replace(/\.?0+$/u, "");
  return value.replace(/^0+(?=\d)/u, "");
}

function numberTokens(raw: string) {
  const text = comparable(raw)
    .replace(/\p{Nd}/gu, asciiDigit)
    .replace(/\bper cent\b/giu, "percent")
    .replace(SPELLED_NUMBER, (_, tens?: string, ones?: string, low?: string) =>
      String(
        tens
          ? (TENS.indexOf(tens.toLowerCase()) + 2) * 10 +
              (ones ? ONES.indexOf(ones.toLowerCase()) + 1 : 0)
          : ONES.indexOf((low ?? "").toLowerCase()) + 1,
      ),
    );
  return [...text.matchAll(NUMBER_TOKEN)].map((match) => {
    const [, prefix, digits, suffix, first, second] = match;
    let word: string | undefined = first?.toLowerCase();
    let value = canonicalNumber(digits);
    const scale = word ? MAGNITUDE[word] : undefined;
    if (scale && /^\d+(?:\.\d+)?$/u.test(value)) {
      value = String(Number((Number(value) * scale).toPrecision(15)));
      word = second?.toLowerCase();
    }
    const wordUnit = word ? UNIT_WORD[word] : undefined;
    return {
      value,
      unit: prefix ?? suffix ?? wordUnit ?? null,
      word: word && !wordUnit && !STOP_WORDS.has(word) ? word : null,
    };
  });
}

const looksLikeYear = (value: string) =>
  /^\d{4}$/u.test(value) && Number(value) >= 1900 && Number(value) <= 2100;

/**
 * Every number must appear whole in the quote with the same unit. With
 * `readWords` the word after it must also be in the quote, so "30 customers"
 * can't borrow its number from "30 days". A year is exempt, since the word
 * after it is usually the next clause.
 */
export function numbersMatchQuote(
  statement: string,
  quote: string,
  readWords: boolean,
) {
  const inQuote = numberTokens(quote);
  const words = wordsOf(comparable(quote));
  return numberTokens(statement).every(({ value, unit, word }) => {
    const found = inQuote.some(
      (entry) =>
        entry.value === value && (unit === null || entry.unit === unit),
    );
    if (!found || !readWords || !word || looksLikeYear(value)) return found;
    return words.some((entry) => sameTerm(entry, word));
  });
}

const NEGATION =
  /^(?:not?|non|none|nothing|nobody|nowhere|never|neither|nor|without|cannot|unable|lack|lacks|lacking|\p{L}+n['’]t)$/u;
// "Not only" and "no later than" don't deny what follows them.
const NOT_A_DENIAL = /^(?:only|just|merely|later|earlier|more|less|fewer)$/u;
const CLAUSE_END =
  /^(?:[.;:!?]|but|however|although|though|yet|instead|whereas|while)$/u;

/**
 * Terms a negation reaches, up to the end of its clause. Commas don't end it, so
 * "not certified, licensed or audited" denies all three. That also catches some
 * later clauses, which only means a statement is left out and listed.
 */
function deniedTerms(text: string) {
  const tokens =
    text.toLowerCase().match(/\p{L}+(?:['’]\p{L}+)*|[.;:!?]/gu) ?? [];
  const denied: string[] = [];
  let denying = false;
  tokens.forEach((token, index) => {
    if (CLAUSE_END.test(token)) denying = false;
    else if (
      NEGATION.test(token) &&
      !NOT_A_DENIAL.test(tokens[index + 1] ?? "")
    )
      denying = true;
    else if (denying) denied.push(...termsOf(token));
  });
  return denied;
}

/**
 * Whether a statement and its quote explicitly disagree: one denies terms the
 * other uses, and they deny none in common. "Charges no fees" and "does not
 * charge fees" agree. This reads polarity only, not meaning, so passing it
 * doesn't make the quote support the statement.
 */
export function contradictsQuote(rawStatement: string, rawQuote: string) {
  const statement = comparable(rawStatement);
  const quote = comparable(rawQuote);
  const deniedInStatement = deniedTerms(statement);
  const deniedInQuote = deniedTerms(quote);
  const overlap = (a: string[], b: string[]) =>
    a.some((term) => b.some((other) => sameTerm(term, other)));
  return (
    !overlap(deniedInStatement, deniedInQuote) &&
    (overlap(deniedInQuote, termsOf(statement)) ||
      overlap(deniedInStatement, termsOf(quote)))
  );
}

/**
 * A cited statement must use its quote's words: every sensitive term, and at
 * least two terms or a third of them, whichever is more. One shared name such
 * as the brand isn't enough.
 */
export function wordingMatchesQuote(rawStatement: string, rawQuote: string) {
  const statement = comparable(rawStatement);
  const quote = comparable(rawQuote);
  const inQuote = termsOf(quote);
  const stated = (term: string) =>
    inQuote.some((entry) => sameTerm(entry, term));
  const sensitive = (statement.match(SENSITIVE_WORD) ?? []).map(
    (match) => wordsOf(match)[0] ?? "",
  );
  const sensitiveStated = sensitive.every((term) =>
    PRICE_WORD.test(term) ? STATES_A_PRICE.test(quote) : stated(term),
  );
  if (!sensitiveStated) return false;
  const terms = [...new Set(termsOf(statement))];
  const shared = terms.filter(stated).length;
  return (
    shared >= Math.min(terms.length, Math.max(2, Math.ceil(terms.length / 3)))
  );
}
