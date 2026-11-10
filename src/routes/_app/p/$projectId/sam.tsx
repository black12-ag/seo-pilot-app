import { createFileRoute } from "@tanstack/react-router";
import { SamChat } from "@/client/features/sam/SamChat";
import { samSearchSchema } from "@/client/features/sam/samAsk";

export const Route = createFileRoute("/_app/p/$projectId/sam")({
  validateSearch: samSearchSchema,
  component: SamRoute,
});

function SamRoute() {
  const { projectId } = Route.useParams();
  const { s, ask } = Route.useSearch();
  return <SamChat projectId={projectId} activeSessionId={s} ask={ask} />;
}
