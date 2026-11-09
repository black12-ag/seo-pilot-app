const MONTHS: Record<string, string> = {
  jan: "Jan",
  feb: "Feb",
  mar: "Mar",
  apr: "Apr",
  may: "May",
  jun: "Jun",
  jul: "Jul",
  aug: "Aug",
  sep: "Sep",
  oct: "Oct",
  nov: "Nov",
  dec: "Dec",
};

/**
 * The crawl months a Common Crawl web graph release covers, from its name:
 * cc-main-2026-aug-sep-oct -> "Aug–Oct 2026",
 * cc-main-2025-26-dec-jan-feb -> "Dec 2025–Feb 2026". Null if unrecognised.
 */
export function crawlPeriodLabel(release: string): string | null {
  const parts = release.replace(/^cc-main-/, "").split("-");
  const years = parts.filter((part) => /^\d+$/.test(part));
  const months = parts.flatMap((part) => MONTHS[part] ?? []);
  const first = months[0];
  const last = months.at(-1);
  const startYear = years[0];
  if (!first || !last || !startYear || startYear.length !== 4) return null;
  if (years.length === 1)
    return first === last
      ? `${first} ${startYear}`
      : `${first}–${last} ${startYear}`;
  const endYear = `${startYear.slice(0, 2)}${years[1]}`;
  return `${first} ${startYear}–${last} ${endYear}`;
}

/** "22 Oct 2026", in UTC so every viewer sees the same day. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
