import { createFileRoute, redirect } from "@tanstack/react-router";
import { KeywordResearchPage } from "@/client/features/keywords/page/KeywordResearchPage";
import { GscKeywordIdeasPage } from "@/client/features/keywords/gsc/GscKeywordIdeasPage";
import { useDataforseoConfigured } from "@/client/features/dataforseo/useDataforseoStatus";
import {
  isResultLimit,
  normalizeKeywordMode,
  normalizeLegacyKeywordSearch,
  normalizeSortDir,
  normalizeSortField,
} from "@/client/features/keywords/keywordSearchParams";
import { keywordsSearchSchema } from "@/types/schemas/keywords";

export const Route = createFileRoute("/_app/p/$projectId/keywords")({
  validateSearch: keywordsSearchSchema,
  // The project switcher keeps this page; filter drafts must not follow.
  remountDeps: ({ params }) => params.projectId,
  beforeLoad: ({ params, search }) => {
    const { normalized, changed } = normalizeLegacyKeywordSearch(search);
    if (!changed) return;

    throw redirect({
      to: "/p/$projectId/keywords",
      params: { projectId: params.projectId },
      search: normalized,
      replace: true,
    });
  },
  component: KeywordResearchPageRoute,
});

function KeywordResearchPageRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  // With no DataForSEO key, research the site's own Search Console queries.
  const dataforseoConfigured = useDataforseoConfigured();
  if (dataforseoConfigured === false)
    return <GscKeywordIdeasPage projectId={projectId} />;
  const {
    q: keywordInput = "",
    loc: locationCode,
    kLimit: resultLimit = 150,
    mode: keywordMode = "auto",
    sort: sortField = "searchVolume",
    order: sortDir = "desc",
  } = search;
  return (
    <KeywordResearchPage
      projectId={projectId}
      keywordInput={keywordInput}
      locationCode={locationCode}
      locationName={search.locName}
      resultLimit={isResultLimit(resultLimit) ? resultLimit : 150}
      keywordMode={normalizeKeywordMode(keywordMode)}
      clickstream={search.cs ?? false}
      groupKeywords={search.grp ?? false}
      sortField={normalizeSortField(sortField)}
      sortDir={normalizeSortDir(sortDir)}
    />
  );
}
