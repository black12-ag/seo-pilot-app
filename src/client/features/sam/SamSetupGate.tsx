import { Link } from "@tanstack/react-router";
import { ShieldAlert, Wrench } from "lucide-react";
import { GateCard } from "@/client/components/GateCard";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { isEveryAppClientAuthMode } from "@/lib/auth-mode";

export function SamSetupGate({
  errorMessage,
  isRefetching,
  onRetry,
}: {
  errorMessage: string | null;
  isRefetching: boolean;
  onRetry: () => void;
}) {
  return (
    <GateCard
      icon={Wrench}
      tone="warning"
      title="Enable AI Features"
      description={
        <>
          {isEveryAppClientAuthMode() ? (
            <p>
              SAM, SEO Pilot&apos;s in-app AI agent, uses OpenRouter through
              your Every App gateway. An admin creates a key on OpenRouter and
              sets it on the gateway with{" "}
              <code>pnpm everyapp secret set OPENROUTER_API_KEY</code>, then
              check again here.
            </p>
          ) : (
            <p>
              SAM, SEO Pilot&apos;s in-app AI agent, needs a way to run AI. Use
              an OpenRouter API key, or your own logged-in subscription on this
              server. Choose in Settings, then check again here.
            </p>
          )}
          <p className="text-xs">
            Step-by-step instructions are in the{" "}
            <Link
              className="underline underline-offset-2 hover:text-foreground"
              to="/help/openrouter-api-key"
            >
              AI setup guide
            </Link>
            .
          </p>
        </>
      }
      actions={
        <>
          <Button size="lg" pending={isRefetching} onClick={onRetry}>
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
    >
      {errorMessage ? (
        <Alert variant="warning">
          <ShieldAlert />
          <AlertDescription className="text-foreground">
            {errorMessage}
          </AlertDescription>
        </Alert>
      ) : null}
    </GateCard>
  );
}
