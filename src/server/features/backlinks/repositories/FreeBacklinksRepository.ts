import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  freeBacklinkProfiles,
  projectCompetitors,
  projects,
} from "@/db/schema";

export type FreeBacklinkProfileRow = typeof freeBacklinkProfiles.$inferSelect;

/** Every live project site and competitor on this installation, as stored. */
async function listTrackedDomains(): Promise<string[]> {
  const sites = await db
    .select({ domain: projects.domain })
    .from(projects)
    .where(and(isNull(projects.archivedAt), isNotNull(projects.domain)));
  const competitors = await db
    .select({ domain: projectCompetitors.domain })
    .from(projectCompetitors)
    .innerJoin(projects, eq(projects.id, projectCompetitors.projectId))
    .where(isNull(projects.archivedAt));
  return [...sites, ...competitors].flatMap((row) =>
    row.domain ? [row.domain] : [],
  );
}

/** One project's competitors, as stored. */
async function listProjectCompetitorDomains(
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ domain: projectCompetitors.domain })
    .from(projectCompetitors)
    .where(eq(projectCompetitors.projectId, projectId));
  return rows.map((row) => row.domain);
}

async function getProfiles(
  domains: string[],
): Promise<FreeBacklinkProfileRow[]> {
  if (domains.length === 0) return [];
  return db
    .select()
    .from(freeBacklinkProfiles)
    .where(inArray(freeBacklinkProfiles.domain, domains));
}

async function saveProfile(row: FreeBacklinkProfileRow): Promise<void> {
  await db
    .insert(freeBacklinkProfiles)
    .values(row)
    .onConflictDoUpdate({
      target: freeBacklinkProfiles.domain,
      set: {
        release: row.release,
        publishedAt: row.publishedAt,
        referringDomains: row.referringDomains,
        referrers: row.referrers,
        importedAt: row.importedAt,
      },
    });
}

export const FreeBacklinksRepository = {
  listTrackedDomains,
  listProjectCompetitorDomains,
  getProfiles,
  saveProfile,
};
