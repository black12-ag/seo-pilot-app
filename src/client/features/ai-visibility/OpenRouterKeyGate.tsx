import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { GateCard } from "@/client/components/GateCard";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonPageContent } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import { useSamAccess } from "@/client/features/sam/useSamAccess";

/**
 * AI visibility setup researches the brand and suggests prompts with AI, so an
 * install with no AI route would only fail after the user starts research. Ask
 * for one first: an API key or the owner's own subscription (hosted always has
 * a key).
 */
export function OpenRouterKeyGate({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const access = useSamAccess(projectId);
  if (access.status === "ready") return children;
  if (access.status === "checking") return <SkeletonPageContent />;
  if (access.status === "error")
    return (
      <QueryError
        error={access.error}
        fallback="Could not check your AI setup."
        onRetry={access.onRetry}
        isRetrying={access.isRetrying}
      />
    );
  return (
    <div className="grid min-h-[calc(100dvh-8rem)] place-items-center">
      <GateCard
        className="max-w-2xl"
        icon={KeyRound}
        tone="warning"
        title="Choose how AI runs"
        description={
          <>
            <p>
              AI visibility uses AI to research your brand and suggest the
              prompts worth tracking, so you don&apos;t have to write them
              yourself. The tracking results, what ChatGPT and other AI engines
              actually answer, come from your DataForSEO account. With no
              DataForSEO key, your own AI engine answers instead, for free.
            </p>
            <p>
              Use an OpenRouter API key, or your own logged-in subscription on
              this server. The{" "}
              <Link
                className="underline underline-offset-2 hover:text-foreground"
                to="/help/openrouter-api-key"
              >
                AI setup guide
              </Link>{" "}
              has the steps for each one.
            </p>
            {access.errorMessage ? <p>{access.errorMessage}</p> : null}
          </>
        }
        actions={
          <>
            <Button
              size="lg"
              pending={access.isRefetching}
              onClick={access.onRetry}
            >
              Check again
            </Button>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link to="/settings" />}
            >
              Open AI engine settings
            </Button>
          </>
        }
      />
    </div>
  );
}
