import { createFileRoute } from "@tanstack/react-router";
import { PublishingPage } from "@/client/features/publishing/PublishingPage";

export const Route = createFileRoute("/_app/p/$projectId/publishing")({
  component: PublishingRoute,
});

function PublishingRoute() {
  const { projectId } = Route.useParams();
  return <PublishingPage projectId={projectId} />;
}
