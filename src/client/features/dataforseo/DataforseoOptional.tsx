import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { dataforseoHelpLinkOptions } from "@/client/navigation/items";
import {
  DATAFORSEO_OPTIONAL_LABEL,
  dataforseoPageFor,
} from "./dataforseoPages";
import { dataforseoStatusQueryOptions } from "./useDataforseoStatus";

/** The one state for anything that can't work with no key. No numbers, no charge. */
export function DataforseoOptionalState({
  gives,
  size,
}: {
  /** What the key adds here, finishing "Add a key to see …". */
  gives: string;
  size?: "sm" | "default" | "lg";
}) {
  return (
    <EmptyState
      variant="card"
      size={size}
      icon={KeyRound}
      title={DATAFORSEO_OPTIONAL_LABEL}
      description={`Add a key to see ${gives}. Audits, Search Console, Analytics and AI work without one.`}
      action={
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link {...dataforseoHelpLinkOptions} />}
        >
          How to add a key
        </Button>
      }
    />
  );
}

/**
 * Stops a page that needs DataForSEO from rendering with no key, so none of its
 * queries run. A failed check lets the page through: its own calls still refuse.
 */
export function DataforseoPageGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const page = dataforseoPageFor(pathname);
  const status = useQuery({
    ...dataforseoStatusQueryOptions(),
    enabled: page !== null,
  });
  if (!page) return children;
  if (status.isPending)
    return (
      <div className="px-4 py-4 md:px-6 md:py-6" aria-busy>
        <Skeleton className="h-8 w-52" />
      </div>
    );
  if (status.data?.configured !== false) return children;
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 md:px-6 md:py-6">
      <h1 className="mb-4 text-2xl font-semibold">{page.title}</h1>
      <DataforseoOptionalState gives={page.gives} />
    </div>
  );
}
