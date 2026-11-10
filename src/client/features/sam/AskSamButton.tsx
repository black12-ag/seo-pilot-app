import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { samAskText } from "./samAsk";

/**
 * Opens SAM in a new chat with `question` in the composer. Nothing is sent
 * until the user presses send. Without an AI engine, SAM shows its setup
 * screen instead.
 */
export function AskSamButton({
  projectId,
  question,
  label = "Ask SAM",
  size = "sm",
  iconOnly = false,
}: {
  projectId: string;
  question: string;
  label?: string;
  size?: "xs" | "sm" | "default";
  /** Icon-only, for table rows; the label becomes the accessible name. */
  iconOnly?: boolean;
}) {
  return (
    <Button
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? (size === "xs" ? "icon-xs" : "icon-sm") : size}
      nativeButton={false}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      render={
        <Link
          to="/p/$projectId/sam"
          params={{ projectId }}
          search={{ ask: samAskText(question) }}
        />
      }
    >
      <Sparkles />
      {iconOnly ? null : label}
    </Button>
  );
}
