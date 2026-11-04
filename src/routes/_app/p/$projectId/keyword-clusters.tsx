import { createFileRoute } from "@tanstack/react-router";
import { KeywordClustersPage } from "@/client/features/keyword-clusters/KeywordClustersPage";

export const Route = createFileRoute("/_app/p/$projectId/keyword-clusters")({
  remountDeps: ({ params }) => params.projectId,
  component: KeywordClustersRoute,
});

function KeywordClustersRoute() {
  const { projectId } = Route.useParams();
  return <KeywordClustersPage projectId={projectId} />;
}
