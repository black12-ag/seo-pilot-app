import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { testDb, activation } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("@/server/features/site-authority/siteAuthorityTestDb");
  return {
    testDb: await createSiteAuthorityTestDb(),
    activation: { betterAuth: true, flag: undefined as string | undefined },
  };
});
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: async () => activation.betterAuth,
  getOptionalEnvValue: async (name: string) =>
    name === "LEGACY_SETUP_CUTOVER_VERIFIED" ? activation.flag : undefined,
}));

import { ProjectRepository } from "./ProjectRepository";
import { ProjectService } from "../services/ProjectService";

afterAll(testDb.close);
beforeEach(async () => {
  activation.betterAuth = true;
  activation.flag = undefined;
  await testDb.seedProject();
});

describe("legacy setup proof on migrated projects", () => {
  it("defaults old and direct SQL projects to false and rejects nonboolean values", async () => {
    expect(
      (
        await ProjectRepository.getProjectForOrganization(
          "project",
          "organization",
        )
      )?.legacySetupAbsenceProven,
    ).toBe(0);
    await testDb.execute(
      "insert into projects(id,organization_id,name) values('raw','organization','Raw')",
    );
    expect(
      (await ProjectRepository.getProjectForOrganization("raw", "organization"))
        ?.legacySetupAbsenceProven,
    ).toBe(0);
    await expect(
      testDb.execute(
        "insert into projects(id,organization_id,name,legacy_setup_absence_proven) values('bad','organization','Bad',2)",
      ),
    ).rejects.toThrow();
  });

  it("marks only explicit cutover plus Better Auth creation and keeps proof out of public DTOs", async () => {
    const off = await ProjectService.createProject("organization", {
      name: "Off",
      domain: "example.com",
    });
    expect("legacySetupAbsenceProven" in off).toBe(false);
    expect(
      (
        await ProjectRepository.getProjectForOrganization(
          off.id,
          "organization",
        )
      )?.legacySetupAbsenceProven,
    ).toBe(0);
    activation.flag = "true";
    activation.betterAuth = false;
    const delegated = await ProjectRepository.createProject(
      "organization",
      "Delegated",
      "example.com",
    );
    expect(delegated.legacySetupAbsenceProven).toBe(0);
    activation.betterAuth = true;
    const created = await ProjectService.createProject("organization", {
      name: "Cutover",
      domain: "example.com",
    });
    expect("legacySetupAbsenceProven" in created).toBe(false);
    expect(
      (
        await ProjectRepository.getProjectForOrganization(
          created.id,
          "organization",
        )
      )?.legacySetupAbsenceProven,
    ).toBe(1);
    expect(
      (await ProjectService.listProjects("organization")).every(
        (project) => !("legacySetupAbsenceProven" in project),
      ),
    ).toBe(true);
  });

  it("does not upgrade an existing default project on conflict", async () => {
    await testDb.execute("delete from projects");
    const first =
      await ProjectRepository.tryCreateDefaultProject("organization");
    expect(first).toBeTruthy();
    activation.flag = "true";
    expect(
      await ProjectRepository.tryCreateDefaultProject("organization"),
    ).toBeNull();
    expect(
      (
        await ProjectRepository.getProjectForOrganization(
          first!,
          "organization",
        )
      )?.legacySetupAbsenceProven,
    ).toBe(0);
    await testDb.execute("delete from projects");
    const marked =
      await ProjectRepository.tryCreateDefaultProject("organization");
    expect(
      (
        await ProjectRepository.getProjectForOrganization(
          marked!,
          "organization",
        )
      )?.legacySetupAbsenceProven,
    ).toBe(1);
  });
});
