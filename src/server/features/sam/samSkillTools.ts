import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { withPgClient } from "@/db";
import { SkillService } from "@/server/features/skills/services/SkillService";
import { AppError } from "@/server/lib/errors";
import type { ToolAuthContext } from "@/server/mcp/context";
import { buildDashboardUrl } from "@/server/mcp/urls";
import {
  SKILL_MAX_DESCRIPTION_CHARS,
  SKILL_MAX_INSTRUCTIONS_CHARS,
  SKILL_MAX_NAME_CHARS,
} from "@/types/schemas/sam-skills";

// "Save this as a skill": SAM writes the workflow from the chat as a draft
// skill. A draft never loads into SAM. A person reads it and turns it on from
// the Skills page, so text from a web page or tool output that steers SAM into
// calling this tool can never become standing instructions on its own.
export function skillTools(auth: ToolAuthContext, projectId: string): ToolSet {
  return {
    save_skill: tool({
      description:
        "Save the workflow from this conversation as a draft skill for this workspace. Call only when the user asks to save, turn or make the workflow into a skill. Write the instructions as numbered steps someone can rerun on any project: name the tools to call, the checks to make and the shape of the answer, and leave out this run's one-off numbers. The draft stays off until the user reviews it and turns it on from the Skills page: say so and give them the returned link. Uses no credits.",
      inputSchema: z.object({
        name: z
          .string()
          .max(SKILL_MAX_NAME_CHARS)
          .describe(
            "Lowercase letters, digits and single hyphens, e.g. weekly-content-check.",
          ),
        description: z
          .string()
          .max(SKILL_MAX_DESCRIPTION_CHARS)
          .describe(
            "One line saying what the skill does and when to use it. SAM picks skills by this.",
          ),
        instructions: z
          .string()
          .max(SKILL_MAX_INSTRUCTIONS_CHARS)
          .describe("Markdown: the steps, in order."),
      }),
      execute: async (input) => {
        try {
          const saved = await withPgClient(() =>
            SkillService.saveSkill({
              organizationId: auth.organizationId,
              ...input,
              status: "draft",
              createdBy: "SAM",
              createdByUserId: auth.userId,
            }),
          );
          return {
            saved: true,
            name: saved.name,
            status: "draft",
            reviewUrl: buildDashboardUrl(
              auth.baseUrl,
              `/p/${projectId}/skills`,
              { skill: saved.name },
            ),
          };
        } catch (error) {
          if (error instanceof AppError) return { error: error.message };
          throw error;
        }
      },
    }),
  };
}
