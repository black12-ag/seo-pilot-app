import { afterAll, beforeEach, expect, it, vi } from "vitest";
const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/runtime-env", () => ({
  usesBetterAuthServer: () => Promise.resolve(true),
}));
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { ProjectRepository } from "./ProjectRepository";
import { WebsiteResearchAttemptRepository as repository } from "./WebsiteResearchAttemptRepository";
import { review, setup, actor } from "./websiteResearchAttemptTestDb";
import { CompetitorResearchRepository } from "@/server/features/competitor-research/repositories/CompetitorResearchRepository";

beforeEach(testDb.seedProject);
afterAll(testDb.close);

async function completed(mode: "direct" | "ai_setup") {
  const { scope, input } = await setup({ mode });
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected receipt winner");
  const claimed = await repository.claimExecution(
    scope,
    input.id,
    admitted.admissionToken,
    1001,
  );
  if (claimed.kind !== "claimed") throw new Error("expected execution winner");
  expect(
    await repository.complete(
      scope,
      input.id,
      claimed.executionToken,
      review,
      1002,
    ),
  ).toMatchObject({ kind: "stored" });
  return { scope, input };
}

// Both earlier authorization queries return real rows; the revocation lands before the final receipt SELECT.
async function afterAuthorizedReads<T>(
  read: () => Promise<T>,
  mutation: string,
) {
  const originalProject = ProjectRepository.getProjectForOrganization;
  const originalMember = ContentRepository.getMembership;
  let release!: () => void;
  let observed!: () => void;
  let reads = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const count = () => {
    if (++reads === 2) observed();
  };
  const projectSpy = vi
    .spyOn(ProjectRepository, "getProjectForOrganization")
    .mockImplementation(async (...args) => {
      const row = await originalProject(...args);
      if (!row) throw new Error("expected prior project authorization");
      count();
      await gate;
      return row;
    });
  const memberSpy = vi
    .spyOn(ContentRepository, "getMembership")
    .mockImplementation(async (...args) => {
      const row = await originalMember(...args);
      if (!row) throw new Error("expected prior member authorization");
      count();
      await gate;
      return row;
    });
  const pending = read();
  try {
    try {
      await ready;
      await testDb.execute(mutation);
    } finally {
      release();
    }
    return await pending;
  } finally {
    projectSpy.mockRestore();
    memberSpy.mockRestore();
  }
}

it("migration rejects admitted and running rows with a NULL active slot", async () => {
  const { scope, input } = await setup();
  const admitted = await repository.admit(scope, input);
  if (admitted.kind !== "created") throw new Error("expected receipt winner");
  const nullSlot = `update project_website_research_attempts set active_project_id=null where id='${input.id}'`;
  await expect(testDb.execute(nullSlot)).rejects.toThrow();
  const claimed = await repository.claimExecution(
    scope,
    input.id,
    admitted.admissionToken,
    1001,
  );
  expect(claimed.kind).toBe("claimed");
  await expect(testDb.execute(nullSlot)).rejects.toThrow();
});

const revocations = [
  ["member deleted", "delete from member where id='membership'"],
  ["role changed", "update member set role='admin' where id='membership'"],
  [
    "project archived",
    "update projects set archived_at='2026-01-01' where id='project'",
  ],
  [
    "project transferred",
    "update projects set organization_id='foreign' where id='project'",
  ],
] as const;

it.each(revocations)(
  "get denies review when %s between authorization and receipt SELECT",
  async (_name, mutation) => {
    const { scope, input } = await completed("direct");
    await expect(
      afterAuthorizedReads(
        () => repository.get(scope, "project", input.id),
        mutation,
      ),
    ).rejects.toThrow("NOT_FOUND");
  },
);

it.each(revocations)(
  "getLatestAi hides review when %s between authorization and receipt SELECT",
  async (_name, mutation) => {
    const { scope } = await completed("ai_setup");
    expect(
      await afterAuthorizedReads(
        () => repository.getLatestAi(scope, "project"),
        mutation,
      ),
    ).toBeNull();
  },
);

it.each(revocations)(
  "start probe hides a receipt when %s before its final SELECT",
  async (_name, mutation) => {
    const { scope, input } = await completed("direct");
    expect(
      await afterAuthorizedReads(
        () => repository.lookupExistingForStart(scope, "project", input.id),
        mutation,
      ),
    ).toEqual({ kind: "missing" });
  },
);

it("returns same-project erasure before scrubbed fields and denies another sponsor", async () => {
  const { scope, input } = await setup();
  expect((await repository.admit(scope, input)).kind).toBe("created");
  expect(
    (await repository.lookupExistingForStart(scope, "project", input.id)).kind,
  ).toBe("receipt");
  await testDb.executeMultiple(
    `insert into "user" (id,name,email,created_at,updated_at) values ('other','Other','other@example.com',${testDb.pg ? "now(),now()" : "0,0"});
     insert into member (id,organization_id,user_id,role,created_at) values ('other-member','organization','other','owner',${testDb.pg ? "now()" : "0"});`,
  );
  const other = await CompetitorResearchRepository.getSnapshot(
    { ...actor, userId: "other", userEmail: "other@example.com" },
    "project",
  );
  expect(
    await repository.lookupExistingForStart(other.scope, "project", input.id),
  ).toEqual({ kind: "missing" });
  expect(
    await repository.lookupExistingForStart(
      scope,
      "project",
      crypto.randomUUID(),
    ),
  ).toEqual({ kind: "missing" });
  await expect(
    repository.lookupExistingForStart(scope, "foreign-project", input.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await testDb.execute(
    `update project_website_research_attempts set redacted_at_ms=1001,request_hash=null,requested_website=null,requested_domain=null,sponsor_user_id=null,sponsor_member_id=null,sponsor_role=null,active_project_id=null,state='unknown',finished_at_ms=1001 where id='${input.id}'`,
  );
  expect(
    await repository.lookupExistingForStart(scope, "project", input.id),
  ).toEqual({ kind: "privacy_erased", attemptId: input.id });
});

it("recognizes restored history as inert before original-sponsor comparison", async () => {
  const { scope, input } = await setup();
  expect((await repository.admit(scope, input)).kind).toBe("created");
  await testDb.execute(
    `update project_website_research_attempts set state='failed',active_project_id=null,finished_at_ms=1001,reason='restored',request_hash=null,sponsor_user_id=null,sponsor_member_id=null,sponsor_role=null where id='${input.id}'`,
  );
  expect(
    await repository.lookupExistingForStart(scope, "project", input.id),
  ).toEqual({ kind: "restored" });
});
