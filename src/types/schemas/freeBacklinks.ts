import { z } from "zod";

/** Most referring domains the import keeps per tracked domain. */
const FREE_BACKLINKS_MAX_ROWS = 5000;

// Release names look like cc-main-2026-aug-sep-oct or cc-main-2025-26-dec-jan-feb.
const COMMON_CRAWL_RELEASE_PATTERN =
  /^cc-main-\d{4}(?:-\d{2})?(?:-[a-z]{3}){1,4}$/;

// Hostname characters only: what the graph holds is a reversed domain name.
const graphDomain = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/);

export const freeBacklinkReferrersSchema = z
  .array(z.tuple([graphDomain, z.number().int().nonnegative()]))
  .max(FREE_BACKLINKS_MAX_ROWS);

export const freeBacklinksImportSchema = z.object({
  release: z.string().regex(COMMON_CRAWL_RELEASE_PATTERN),
  publishedAt: z.string().datetime().nullable(),
  profile: z
    .object({
      domain: graphDomain,
      referringDomains: z.number().int().nonnegative(),
      referrers: freeBacklinkReferrersSchema,
    })
    .refine((p) => p.referringDomains >= p.referrers.length, {
      message: "The count can't be smaller than the list",
    }),
});

export const freeBacklinksInputSchema = z.object({
  projectId: z.string().min(1),
  target: z.string().max(2048).optional(),
});

export type FreeBacklinksTracked = {
  domain: string;
  role: "site" | "competitor";
  /** Null until the data has been prepared for this domain. */
  referringDomains: number | null;
};

export type FreeBacklinksSelected =
  | { domain: string; status: "not_tracked" }
  | { domain: string; status: "not_prepared" }
  | {
      domain: string;
      status: "ready";
      release: string;
      publishedAt: string | null;
      importedAt: string;
      referringDomains: number;
      referrers: { domain: string; hosts: number }[];
    };

export type FreeBacklinksResult = {
  tracked: FreeBacklinksTracked[];
  selected: FreeBacklinksSelected | null;
};
