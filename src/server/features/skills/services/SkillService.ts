import { stringify as stringifyYaml } from "yaml";
import { SkillRepository } from "@/server/features/skills/repositories/SkillRepository";
import { SkillScheduleRepository } from "@/server/features/skills/repositories/SkillScheduleRepository";
import { listBuiltInSkills } from "@/server/features/sam/samSkills";
import { AppError } from "@/server/lib/errors";
import { formatCount } from "@/shared/format";
import {
  SKILL_MAX_DESCRIPTION_CHARS,
  SKILL_MAX_INSTRUCTIONS_CHARS,
  SKILL_MAX_NAME_CHARS,
  SKILL_MAX_PER_ORGANIZATION,
  SKILL_NAME_PATTERN,
  type CustomSkill,
  type SkillListItem,
  type SkillStatus,
} from "@/types/schemas/sam-skills";

// Skills for SAM and for agents connected over MCP. Every caller (server
// function, SAM tool, MCP tool) comes through here, so the caps, the name rule
// and the refusal copy exist once. Authorization is NOT done here: callers pass
// the organization from the authenticated context, and every query is scoped
// to it.

const invalid = (message: string) => new AppError("VALIDATION_ERROR", message);

/** Trims, checks the Agent Skills rules and our caps. Throws with fix-it copy. */
function validateSkillInput(input: {
  name: string;
  description: string;
  instructions: string;
}) {
  const name = input.name.trim();
  // The description is one YAML line in SKILL.md.
  const description = input.description.replace(/\s+/g, " ").trim();
  const instructions = input.instructions.trim();
  if (!name) throw invalid("Give the skill a name, like weekly-content-check.");
  if (name.length > SKILL_MAX_NAME_CHARS)
    throw invalid(
      `Name is ${formatCount(name.length)} characters; the limit is ${SKILL_MAX_NAME_CHARS}.`,
    );
  if (!SKILL_NAME_PATTERN.test(name))
    throw invalid(
      "Use lowercase letters, digits and single hyphens in the name, like weekly-content-check. No spaces, and no hyphen at the start or end.",
    );
  if (listBuiltInSkills().some((skill) => skill.name === name))
    throw invalid(
      `"${name}" is a built-in skill. Choose another name, like ${name}-custom.`,
    );
  if (!description)
    throw invalid(
      "Add a description saying when to use the skill. SAM reads it to decide.",
    );
  if (description.length > SKILL_MAX_DESCRIPTION_CHARS)
    throw invalid(
      `Description is ${formatCount(description.length)} characters; the limit is ${formatCount(SKILL_MAX_DESCRIPTION_CHARS)}. Move the detail into the instructions.`,
    );
  if (!instructions)
    throw invalid("Add instructions: the steps SAM should follow, in order.");
  if (instructions.length > SKILL_MAX_INSTRUCTIONS_CHARS)
    throw invalid(
      `Instructions are ${formatCount(instructions.length)} characters; the limit is ${formatCount(SKILL_MAX_INSTRUCTIONS_CHARS)}. A skill is a procedure: keep the steps and cut the background.`,
    );
  return { name, description, instructions };
}

/** Built-in skills first, then this workspace's own, each sorted by name. */
async function listSkills(organizationId: string): Promise<SkillListItem[]> {
  const custom = await SkillRepository.listSkills(organizationId);
  return [
    ...listBuiltInSkills().map((skill) => ({
      source: "builtin" as const,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
    })),
    ...custom.map((skill) => ({ source: "custom" as const, ...skill })),
  ];
}

type SaveParams = {
  organizationId: string;
  skillId?: string;
  name: string;
  description: string;
  instructions: string;
  /** Used on create only. SAM always saves drafts. */
  status: SkillStatus;
  /** Client label, stamped by the server ("SEO Pilot app", "SAM"). */
  createdBy: string;
  createdByUserId: string;
};

/** Create-or-update. Everything is validated before anything is written. */
async function saveSkill(
  params: SaveParams,
): Promise<{ skillId: string; name: string; created: boolean }> {
  const values = validateSkillInput(params);
  const skills = await SkillRepository.listSkills(params.organizationId);
  const existing = params.skillId
    ? skills.find((skill) => skill.id === params.skillId)
    : undefined;
  if (params.skillId && !existing)
    throw new AppError("NOT_FOUND", "That skill is not in this workspace.");
  const clash = skills.find(
    (skill) => skill.name === values.name && skill.id !== existing?.id,
  );
  if (clash)
    throw invalid(
      `A skill named "${values.name}" already exists in this workspace. Edit that one, or choose another name.`,
    );

  if (existing) {
    await SkillRepository.updateSkill({
      organizationId: params.organizationId,
      skillId: existing.id,
      ...values,
    });
    if (existing.name !== values.name)
      await SkillScheduleRepository.renameSkill(
        params.organizationId,
        existing.name,
        values.name,
      );
    return { skillId: existing.id, name: values.name, created: false };
  }

  // A guardrail, not an invariant: two concurrent saves at the cap can pass.
  if (skills.length >= SKILL_MAX_PER_ORGANIZATION)
    throw invalid(
      `This workspace has ${SKILL_MAX_PER_ORGANIZATION} skills, the limit. Delete one you no longer use.`,
    );
  const id = crypto.randomUUID();
  await SkillRepository.insertSkill({
    id,
    organizationId: params.organizationId,
    ...values,
    status: params.status,
    createdBy: params.createdBy,
    createdByUserId: params.createdByUserId,
  });
  return { skillId: id, name: values.name, created: true };
}

async function setSkillStatus(
  organizationId: string,
  skillId: string,
  status: SkillStatus,
): Promise<void> {
  if (!(await SkillRepository.setStatus(organizationId, skillId, status)))
    throw new AppError("NOT_FOUND", "That skill is not in this workspace.");
}

/** Deletes the skill and every schedule that runs it. */
async function deleteSkill(
  organizationId: string,
  skillId: string,
): Promise<void> {
  const name = await SkillRepository.deleteSkill(organizationId, skillId);
  if (!name)
    throw new AppError("NOT_FOUND", "That skill is not in this workspace.");
  await SkillScheduleRepository.deleteForSkill(organizationId, name);
}

/**
 * A skill SAM or an agent may run: a built-in one, or this workspace's own
 * when it is turned on.
 */
async function getRunnableSkill(
  organizationId: string,
  name: string,
): Promise<
  | { source: "builtin"; name: string; description: string; raw: string }
  | { source: "custom"; skill: CustomSkill }
  | null
> {
  const builtIn = listBuiltInSkills().find((skill) => skill.name === name);
  if (builtIn) return { source: "builtin", ...builtIn };
  const skill = await SkillRepository.getSkillByName(organizationId, name);
  return skill?.status === "enabled" ? { source: "custom", skill } : null;
}

/** A valid Agent Skills SKILL.md for a custom skill. */
function renderSkillFile(skill: {
  name: string;
  description: string;
  instructions: string;
}): string {
  const frontmatter = stringifyYaml(
    { name: skill.name, description: skill.description },
    { lineWidth: 0 },
  );
  return `---\n${frontmatter}---\n\n${skill.instructions.trim()}\n`;
}

/**
 * The SKILL.md for any skill in this workspace's list (drafts and disabled
 * skills too: the file is the user's own data). Null when there is none.
 */
async function getSkillFile(
  organizationId: string,
  name: string,
): Promise<string | null> {
  const builtIn = listBuiltInSkills().find((skill) => skill.name === name);
  if (builtIn) return builtIn.raw;
  const skill = await SkillRepository.getSkillByName(organizationId, name);
  return skill ? renderSkillFile(skill) : null;
}

export const SkillService = {
  listSkills,
  saveSkill,
  setSkillStatus,
  deleteSkill,
  getRunnableSkill,
  getSkillFile,
} as const;
