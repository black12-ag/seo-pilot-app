import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";

/** The domain a Search Console property URL stands for, for display. */
export function gscPropertyDomain(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice(10);
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, "");
  } catch {
    return siteUrl;
  }
}

/** What Search Console positions are, said once wherever they show. */
export const GSC_POSITION_NOTE =
  "Positions come from your Google Search Console: the average position over each day's impressions, only for searches where your site appeared. Search Console data is about 2-3 days behind.";

/** The Search Console part of the add-domain form. */
export function GscSourceFields({
  projectId,
  siteUrl,
  isPending,
  country,
  onCountryChange,
  countryId,
}: {
  projectId: string;
  siteUrl: string | null;
  isPending: boolean;
  country: string;
  onCountryChange: (country: string) => void;
  countryId: string;
}) {
  return (
    <>
      <Field>
        <FieldLabel>Site</FieldLabel>
        {isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : siteUrl ? (
          <p className="rounded-md border bg-muted px-3 py-2 text-sm">
            {gscPropertyDomain(siteUrl)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Search Console isn't connected for this project.{" "}
            <Link
              to="/p/$projectId/search-performance"
              params={{ projectId }}
              className="text-primary hover:underline"
            >
              Connect it on GSC Insights
            </Link>{" "}
            to track your rankings for free.
          </p>
        )}
        <FieldDescription>
          Search Console only reports your own verified site.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={countryId}>Country (optional)</FieldLabel>
        <Input
          id={countryId}
          value={country}
          maxLength={3}
          placeholder="All countries"
          onChange={(event) =>
            onCountryChange(event.target.value.trim().toLowerCase())
          }
        />
        <FieldDescription>
          A 3-letter country code as Search Console uses it, like usa, gbr or
          deu. Leave empty for all countries.
        </FieldDescription>
      </Field>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {GSC_POSITION_NOTE} Free, and the last 30 days fill in as soon as you
        add keywords.
      </p>
    </>
  );
}

/**
 * The source line of the domain form when there is no choice to make: an
 * existing Search Console tracker, or a new one on an install with no key.
 */
export function GscSourceIntro({
  config,
}: {
  config?: { domain: string; gscCountry: string; source: string } | null;
}) {
  if (config) {
    if (config.source !== "gsc") return null;
    return (
      <p className="text-sm text-muted-foreground">
        Positions from Search Console for {config.domain}
        {config.gscCountry
          ? ` (${config.gscCountry.toUpperCase()}).`
          : " (all countries)."}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      Free rank tracking from your Search Console. Add a DataForSEO key to check
      live Google results for any domain.
    </p>
  );
}
