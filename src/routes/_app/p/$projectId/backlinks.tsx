import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BacklinksPage } from "@/client/features/backlinks/BacklinksPage";
import { FreeBacklinksPage } from "@/client/features/backlinks/FreeBacklinksPage";
import { dataforseoStatusQueryOptions } from "@/client/features/dataforseo/useDataforseoStatus";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  DEFAULT_BACKLINKS_PAGE_SIZE,
  backlinksSearchSchema,
} from "@/types/schemas/backlinks";
import { defaultScopeForInput } from "@/shared/researchScope";

export const Route = createFileRoute("/_app/p/$projectId/backlinks")({
  validateSearch: backlinksSearchSchema,
  component: BacklinksRoute,
});

function BacklinksRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const {
    target = "",
    scope: rawScope,
    tab = "backlinks",
    page = 1,
    size = DEFAULT_BACKLINKS_PAGE_SIZE,
    sort,
    order,
    view,
    includeSpam,
  } = Route.useSearch();
  const scope = rawScope ?? defaultScopeForInput(target);
  // With no DataForSEO key the page shows free Common Crawl data instead. A
  // failed check falls through to the DataForSEO page, whose calls refuse.
  const dataforseo = useQuery(dataforseoStatusQueryOptions());

  if (dataforseo.isPending)
    return (
      <div className="px-4 py-4 md:px-6 md:py-6" aria-busy>
        <Skeleton className="h-8 w-52" />
      </div>
    );
  if (dataforseo.data?.configured === false)
    return (
      <FreeBacklinksPage
        projectId={projectId}
        target={target}
        onTargetChange={(next) =>
          navigate({ search: { target: next }, replace: true })
        }
      />
    );

  return (
    <BacklinksPage
      projectId={projectId}
      navigate={navigate}
      searchState={{
        target,
        scope,
        // Referring domains can't be filtered to a subfolder.
        tab: scope === "subfolder" && tab === "domains" ? "backlinks" : tab,
        page,
        pageSize: size,
        sort,
        order,
        view,
        includeSpam,
      }}
    />
  );
}
