import { sort, sumBy } from "remeda";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import {
  getIssueSamplePagesForAudit,
  getIssueTypePageCountsForAudit,
} from "@/server/features/audit/repositories/auditSummaryQueries";
import { DashboardSiteService } from "@/server/features/dashboard/services/DashboardSiteService";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { isStrikingDistancePosition } from "@/server/features/gsc/searchPerformanceReport";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { getIssueDescriptor, type IssueSeverity } from "@/shared/audit-issues";
import { formatCount } from "@/shared/format";
import type {
  Opportunity,
  OpportunityEffort,
  OpportunitySeverity,
  OpportunitySource,
} from "@/shared/opportunities";
import {
  plural,
  SAMPLE_SIZE,
  setupNudge,
  SOURCE_META,
  type SourceInput,
  type SourceReading,
} from "./opportunityParts";

const SEVERITY: Record<IssueSeverity, OpportunitySeverity> = {
  critical: "high",
  warning: "medium",
  info: "low",
};

// Crawl results that mean some pages were never read, so "no findings" would
// overstate what the audit saw.
const INCOMPLETE_CRAWL_ISSUES = new Set([
  "blocked-page",
  "rate-limited-page",
  "crawl-rate-limited",
  "crawl-time-limit",
  "crawl-credits-exhausted",
]);

function technicalEffort(pages: number): OpportunityEffort {
  if (pages <= 10) return "small";
  return pages <= 100 ? "medium" : "large";
}

export async function readSiteAudit({
  projectId,
}: SourceInput): Promise<SourceReading> {
  const { label, link: auditLink } = SOURCE_META.site_audit;
  const audits = await AuditRepository.getAuditsByProject(projectId);
  const audit = audits.find((row) => row.status === "completed");
  if (!audit) {
    const running = audits.some((row) => row.status === "running");
    const detail = running
      ? "The first audit is still running."
      : "No site audit has finished for this project.";
    return {
      source: {
        ...SOURCE_META.site_audit,
        state: "not_checked",
        detail,
        checkedAt: null,
      },
      opportunities: [],
      setup: running
        ? []
        : [
            setupNudge({
              id: "setup:site-audit",
              title: "Run your first site audit",
              whyItMatters:
                "An audit shows which pages have technical problems. Until one finishes, your site has not been checked.",
              nextStep: "Start an audit from the Site audit page.",
              evidence: {
                source: label,
                summary: detail,
                observedAt: null,
                items: [],
                moreCount: 0,
                link: auditLink,
              },
            }),
          ],
    };
  }
  const checkedAt = audit.completedAt ?? audit.startedAt;
  const link: OpportunitySource["link"] = {
    label: "Open this audit",
    target: { page: "audit", auditId: audit.id },
  };
  if (audit.pagesCrawled === 0)
    return {
      source: {
        ...SOURCE_META.site_audit,
        state: "not_checked",
        detail: "The last audit finished without reading any pages.",
        checkedAt,
        link,
      },
      opportunities: [],
      setup: [],
    };
  const issueTypes = await getIssueTypePageCountsForAudit(audit.id);
  const opportunities = await Promise.all(
    issueTypes.map(async ({ issueType, severity, pages }) => {
      const descriptor = getIssueDescriptor(issueType);
      const sample = await getIssueSamplePagesForAudit(
        audit.id,
        issueType,
        SAMPLE_SIZE,
      );
      return {
        id: `audit:${issueType}`,
        type: "technical",
        title: descriptor?.title ?? issueType.replaceAll("-", " "),
        whyItMatters:
          descriptor?.explanation ?? "The site audit recorded this issue.",
        nextStep:
          descriptor?.howToFix ?? "Open the audit to read the affected pages.",
        severity: SEVERITY[severity],
        affected: { count: pages, unit: "page" },
        effort: technicalEffort(pages),
        status: "open",
        evidence: {
          source: label,
          summary: `${formatCount(pages)} of ${plural(audit.pagesCrawled, "crawled page")}.`,
          observedAt: checkedAt,
          items: sample.map((url) => ({ label: url, url })),
          moreCount: Math.max(0, pages - sample.length),
          link,
        },
      } satisfies Opportunity;
    }),
  );
  const incomplete = issueTypes.some((row) =>
    INCOMPLETE_CRAWL_ISSUES.has(row.issueType),
  );
  return {
    source: {
      ...SOURCE_META.site_audit,
      state: "checked",
      detail: `${plural(audit.pagesCrawled, "page")} read.${
        incomplete
          ? " Some pages could not be read, so they were not checked."
          : ""
      }`,
      checkedAt,
      link,
    },
    opportunities,
    setup: [],
  };
}

export async function readSearchConsole({
  projectId,
  organizationId,
}: SourceInput): Promise<SourceReading> {
  const { label, link } = SOURCE_META.search_console;
  const connection = await GscConnectionRepository.getByProjectId(projectId);
  if (!connection) {
    const detail = "Search Console is not connected to this project.";
    return {
      source: {
        ...SOURCE_META.search_console,
        state: "needs_setup",
        detail,
        checkedAt: null,
      },
      opportunities: [],
      setup: [
        setupNudge({
          id: "setup:search-console",
          title: "Connect Search Console",
          whyItMatters:
            "Search Console shows the searches you already appear for, including the ones close to the top of the results.",
          nextStep: "Connect your property from the Search Performance page.",
          evidence: {
            source: "Project connections",
            summary: detail,
            observedAt: null,
            items: [],
            moreCount: 0,
            link,
          },
        }),
      ],
    };
  }
  const saved = await DashboardSiteService.getSavedKeywords(
    projectId,
    organizationId,
    connection,
  );
  if (!saved)
    return {
      source: {
        ...SOURCE_META.search_console,
        state: "not_checked",
        detail:
          "No Search Console data is saved yet. Open Keywords on the Overview page and choose Top keywords to save the last 28 days.",
        checkedAt: null,
        link: { label: "Open Keywords", target: { page: "overview" } },
      },
      opportunities: [],
      setup: [],
    };
  const { rows, startDate, endDate } = saved.value;
  const period = `${startDate} to ${endDate}`;
  const striking = sort(
    rows.filter((row) => isStrikingDistancePosition(row.position)),
    (a, b) => b.impressions - a.impressions,
  );
  const source: OpportunitySource = {
    ...SOURCE_META.search_console,
    state: "checked",
    detail: `${plural(rows.length, "query", "queries")} saved for ${period}.`,
    checkedAt: saved.fetchedAt,
  };
  if (!striking.length) return { source, opportunities: [], setup: [] };
  return {
    source,
    setup: [],
    opportunities: [
      {
        id: "search-console:striking-distance",
        type: "content",
        title: "Improve pages for searches close to the top",
        whyItMatters:
          "You already appear for these searches, in positions 5 to 20. Better content on the matching pages is the most direct way to earn more clicks from them.",
        nextStep:
          "Start with the searches that have the most impressions, and improve the page that ranks for each one.",
        severity: "medium",
        affected: { count: striking.length, unit: "query" },
        effort: "medium",
        status: "open",
        evidence: {
          source: label,
          summary: `${plural(striking.length, "query", "queries")} in positions 5 to 20, ${period}. ${formatCount(sumBy(striking, (row) => row.impressions))} impressions.`,
          observedAt: saved.fetchedAt,
          items: striking.slice(0, SAMPLE_SIZE).map((row) => ({
            label: row.query,
            detail: `Position ${row.position.toFixed(1)}, ${plural(row.impressions, "impression")}, ${plural(row.clicks, "click")}`,
          })),
          moreCount: Math.max(0, striking.length - SAMPLE_SIZE),
          link,
        },
      },
    ],
  };
}

export async function readCompetitors({
  projectId,
}: SourceInput): Promise<SourceReading> {
  const { link } = SOURCE_META.competitors;
  const [saved, unsaved] = await Promise.all([
    ProjectContextRepository.listCompetitors(projectId),
    ProjectContextRepository.listUnsavedCompetitorCandidates(projectId),
  ]);
  const setup: Opportunity[] = [];
  if (unsaved.length) {
    const captured = unsaved.flatMap((row) => row.capturedAtMs ?? []);
    setup.push(
      setupNudge({
        id: "setup:competitor-review",
        title: "Review the competitors research found",
        whyItMatters:
          "Saved competitors are what AI visibility compares you with. These were found and checked, but aren't saved to this project yet.",
        nextStep: "Accept the ones that fit on the Context page.",
        evidence: {
          source: "Competitor research",
          summary: `${plural(unsaved.length, "competitor")} not saved yet.`,
          observedAt: captured.length
            ? new Date(Math.max(...captured)).toISOString()
            : null,
          items: unsaved.slice(0, SAMPLE_SIZE).map((row) => ({
            label: row.name ?? row.domain,
            detail: row.name ? row.domain : undefined,
            url: row.sourceUrl ?? undefined,
          })),
          moreCount: Math.max(0, unsaved.length - SAMPLE_SIZE),
          link,
        },
      }),
    );
  } else if (!saved.length) {
    setup.push(
      setupNudge({
        id: "setup:competitors",
        title: "Add your competitors",
        whyItMatters:
          "With competitors saved, AI visibility can show who is named where you aren't.",
        nextStep:
          "Add them yourself or run competitor research on the Context page.",
        evidence: {
          source: "Project settings",
          summary: "No competitors are saved for this project.",
          observedAt: null,
          items: [],
          moreCount: 0,
          link,
        },
      }),
    );
  }
  return {
    source: {
      ...SOURCE_META.competitors,
      state: saved.length ? "checked" : "needs_setup",
      detail: saved.length
        ? `${plural(saved.length, "competitor")} saved.`
        : "No competitors are saved for this project.",
      checkedAt: null,
    },
    opportunities: [],
    setup,
  };
}
