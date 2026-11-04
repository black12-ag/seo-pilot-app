import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SourcesPage } from "@/client/features/ai-visibility/SourcesPage";

export const Route = createFileRoute(
  "/_app/p/$projectId/ai-visibility/sources",
)({
  validateSearch: z.object({
    domain: z.string().trim().min(1).max(253).optional().catch(undefined),
  }),
  component: SourcesRoute,
});

function SourcesRoute() {
  const { projectId } = Route.useParams();
  const { domain } = Route.useSearch();
  return <SourcesPage key={projectId} projectId={projectId} domain={domain} />;
}
