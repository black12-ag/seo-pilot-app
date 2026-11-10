import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { samSkills } from "@/db/schema";
import type { CustomSkill, SkillStatus } from "@/types/schemas/sam-skills";

// Backing store for a workspace's custom skills. Every query filters on
// `organization_id` as well as `id` or `name` — never a bare `WHERE id = ?` —
// so a skill id or name from another workspace never resolves.

const columns = {
  id: samSkills.id,
  organizationId: samSkills.organizationId,
  name: samSkills.name,
  description: samSkills.description,
  instructions: samSkills.instructions,
  status: samSkills.status,
  createdBy: samSkills.createdBy,
  createdByUserId: samSkills.createdByUserId,
  createdAt: samSkills.createdAt,
  updatedAt: samSkills.updatedAt,
};

async function listSkills(organizationId: string): Promise<CustomSkill[]> {
  return db
    .select(columns)
    .from(samSkills)
    .where(eq(samSkills.organizationId, organizationId))
    .orderBy(asc(samSkills.name));
}

/** The skills SAM may load for this workspace. */
async function listEnabledSkills(
  organizationId: string,
): Promise<CustomSkill[]> {
  return db
    .select(columns)
    .from(samSkills)
    .where(
      and(
        eq(samSkills.organizationId, organizationId),
        eq(samSkills.status, "enabled"),
      ),
    )
    .orderBy(asc(samSkills.name));
}

async function getSkill(
  organizationId: string,
  skillId: string,
): Promise<CustomSkill | null> {
  const [row] = await db
    .select(columns)
    .from(samSkills)
    .where(
      and(
        eq(samSkills.organizationId, organizationId),
        eq(samSkills.id, skillId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getSkillByName(
  organizationId: string,
  name: string,
): Promise<CustomSkill | null> {
  const [row] = await db
    .select(columns)
    .from(samSkills)
    .where(
      and(
        eq(samSkills.organizationId, organizationId),
        eq(samSkills.name, name),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Timestamps are stamped here: the two dialects' defaults render differently.
async function insertSkill(
  params: Omit<CustomSkill, "createdAt" | "updatedAt">,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(samSkills)
    .values({ ...params, createdAt: now, updatedAt: now });
}

// Content and status only: attribution is stamped at create and kept.
async function updateSkill(params: {
  organizationId: string;
  skillId: string;
  name: string;
  description: string;
  instructions: string;
}): Promise<void> {
  await db
    .update(samSkills)
    .set({
      name: params.name,
      description: params.description,
      instructions: params.instructions,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(samSkills.organizationId, params.organizationId),
        eq(samSkills.id, params.skillId),
      ),
    );
}

async function setStatus(
  organizationId: string,
  skillId: string,
  status: SkillStatus,
): Promise<boolean> {
  const updated = await db
    .update(samSkills)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(samSkills.organizationId, organizationId),
        eq(samSkills.id, skillId),
      ),
    )
    .returning({ id: samSkills.id });
  return updated.length > 0;
}

/** The deleted skill's name, or null when the id is not in this workspace. */
async function deleteSkill(
  organizationId: string,
  skillId: string,
): Promise<string | null> {
  const deleted = await db
    .delete(samSkills)
    .where(
      and(
        eq(samSkills.organizationId, organizationId),
        eq(samSkills.id, skillId),
      ),
    )
    .returning({ name: samSkills.name });
  return deleted[0]?.name ?? null;
}

export const SkillRepository = {
  listSkills,
  listEnabledSkills,
  getSkill,
  getSkillByName,
  insertSkill,
  updateSkill,
  setStatus,
  deleteSkill,
} as const;
