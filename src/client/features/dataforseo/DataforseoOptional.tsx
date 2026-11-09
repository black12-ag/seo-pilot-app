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
  type FreeAlternative,
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
      description={`Add a key to see ${gives}. Audits, Search Console, rank tracking from Search Console, Analytics and AI work without one.`}
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

const FREE_ALTERNATIVES: Record<
  FreeAlternative,
  {
    to:
      | "/p/$projectId/search-performance"
      | "/p/$projectId/rank-tracking"
      | "/p/$projectId/keywords"
      | "/p/$projectId/backlinks";
    label: string;
    detail: string;
  }
> = {
  "search-performance": {
    to: "/p/$projectId/search-performance",
    label: "GSC Insights",
    detail:
      "your own site's clicks, impressions, top queries and top pages from Search Console",
  },
  "rank-tracking": {
    to: "/p/$projectId/rank-tracking",
    label: "Rank Tracking",
    detail: "your own keywords' average positions from Search Console, daily",
  },
  keywords: {
    to: "/p/$projectId/keywords",
    label: "Keyword Research",
    detail:
      "the queries your site already gets impressions for, and those close to page one",
  },
  backlinks: {
    to: "/p/$projectId/backlinks",
    label: "Backlinks",
    detail: "sites that link to you and your competitors, from Common Crawl",
  },
};

/** Free pages that cover part of what a gated page does, for the own site. */
function FreeAlternatives({
  projectId,
  alternatives,
}: {
  projectId: string;
  alternatives: FreeAlternative[];
}) {
  return (
    <div className="mt-4 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Free without a key</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Competitor data has no free, legitimate source, but these work for your
        own site at no cost:
      </p>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {alternatives.map((key) => {
          const item = FREE_ALTERNATIVES[key];
          return (
            <li key={key}>
              <Link
                to={item.to}
                params={{ projectId }}
                className="font-medium text-primary hover:underline"
              >
                {item.label}
              </Link>
              <span className="text-muted-foreground"> — {item.detail}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Stops a page that needs DataForSEO from rendering with no key, so none of its
 * queries run. AI visibility pages pass when the own AI engine is set up. A
 * failed check lets the page through: its own calls still refuse.
 */
export function DataforseoPageGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const projectId = /^\/p\/([^/]+)/.exec(pathname)?.[1];
  const gated = dataforseoPageFor(pathname) !== null;
  const status = useQuery({
    ...dataforseoStatusQueryOptions(),
    enabled: gated,
  });
  const page = dataforseoPageFor(
    pathname,
    status.data?.ownAiEngine.available ?? false,
  );
  if (!gated) return children;
  if (status.isPending)
    return (
      <div className="px-4 py-4 md:px-6 md:py-6" aria-busy>
        <Skeleton className="h-8 w-52" />
      </div>
    );
  if (status.data?.configured !== false || !page) return children;
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 md:px-6 md:py-6">
      <h1 className="mb-4 text-2xl font-semibold">{page.title}</h1>
      <DataforseoOptionalState gives={page.gives} />
      {page.alternatives && projectId && (
        <FreeAlternatives
          projectId={projectId}
          alternatives={page.alternatives}
        />
      )}
    </div>
  );
}
