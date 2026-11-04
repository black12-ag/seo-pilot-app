import { beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import { getOpportunities } from "./opportunities";

const { list, sentinel, middleware } = vi.hoisted(() => ({
  list: vi.fn(),
  sentinel: ["project-context"],
  middleware: { used: null as unknown },
}));
vi.mock(
  "@/server/features/opportunities/services/OpportunitiesService",
  () => ({ OpportunitiesService: { list } }),
);
vi.mock("@/serverFunctions/middleware", () => ({
  requireProjectContext: sentinel,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: (used: unknown) => {
      middleware.used = used;
      return {
        validator: (schema: z.ZodType) => ({
          handler:
            (
              handler: (input: {
                data: unknown;
                context: { projectId: string; organizationId: string };
              }) => unknown,
            ) =>
            ({ data }: { data: unknown }) =>
              handler({
                data: schema.parse(data),
                context: {
                  projectId: "authorized-project",
                  organizationId: "authorized-organization",
                },
              }),
        }),
      };
    },
  }),
}));

beforeEach(() => list.mockReset());

it("reads only the project the middleware authorized", async () => {
  await getOpportunities({ data: { projectId: "requested-project" } });
  expect(middleware.used).toBe(sentinel);
  expect(list).toHaveBeenCalledWith({
    projectId: "authorized-project",
    organizationId: "authorized-organization",
  });
});
