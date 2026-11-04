import { createFileRoute } from "@tanstack/react-router";
import { KeywordGapPage } from "@/client/features/keyword-gap/KeywordGapPage";

export const Route = createFileRoute("/_app/p/$projectId/keyword-gap")({
  remountDeps: ({ params }) => params.projectId,
  component: KeywordGapRoute,
});

function KeywordGapRoute() {
  const { projectId } = Route.useParams();
  return <KeywordGapPage projectId={projectId} />;
}
