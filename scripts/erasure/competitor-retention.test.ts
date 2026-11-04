import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../src/server/features/site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: testDb.provider },
}));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

import { buildInventory } from "./inventory";
import { erasePostgres, verifyPostgres } from "./postgres";

beforeEach(testDb.seedProject);
afterAll(testDb.close);

async function seedPrivateRun() {
  await testDb.executeMultiple(`
    insert into project_competitor_research_runs
      (id,project_id,organization_id,admission_token,request_id,request_hash,origin,state,outcome,sponsor_user_id,sponsor_member_id,sponsor_role,surface,model_configuration_hash,domain,location_code,language_code,context_version,context_hash,business_summary,created_at_ms,deadline_at_ms,finished_at_ms,billing_state)
      values ('private-run','project','organization','nonce','private-request','hash','setup','finished','complete','user','membership','owner','web','modelhash','example.com',2840,'en',0,'contexthash','Private business',1,1000,2,'not_started');
    insert into project_competitor_research_candidates
      (id,project_id,run_id,domain,rank_order,source_url,source_excerpt,classification)
      values ('private-candidate','project','private-run','rival.com',0,'https://rival.com/','Private excerpt','verified');
  `);
}

describe.skipIf(testDb.provider !== "postgres")(
  "departed competitor sponsor erasure",
  () => {
    it("finds work outside current memberships, stops only its workflows, and leaves the shared project", async () => {
      if (!testDb.pg) throw new Error("PostgreSQL fixture required");
      await testDb.executeMultiple(`
        insert into "user" (id,name,email,created_at,updated_at) values ('other','Other','other@example.com',now(),now());
        insert into member (id,organization_id,user_id,role,created_at) values ('other-member','organization','other','owner',now());
        insert into project_competitor_research_runs
          (id,project_id,organization_id,admission_token,request_id,request_hash,origin,state,outcome,active_project_id,sponsor_user_id,sponsor_member_id,sponsor_role,surface,model_configuration_hash,domain,location_code,language_code,context_version,context_hash,business_summary,created_at_ms,deadline_at_ms,finished_at_ms,billing_state)
          values ('run','project','organization','nonce','request','hash','setup','finished','complete',null,'user','membership','owner','web','modelhash','example.com',2840,'en',0,'contexthash','Private business',1,1000,2,'started');
        insert into project_competitor_research_operations
          (id,project_id,run_id,slot,kind,state,finished_at_ms,usage_basis,cost_usd)
          values ('operation','project','run','setup_evidence','legacy','succeeded',2,'usd',0.03);
        insert into project_competitor_research_candidates
          (id,project_id,run_id,domain,rank_order,source_url,source_excerpt,source_hash,source_captured_at_ms,extraction_method,classification,name,rationale,selected,accepted_name,accepted_notes,acceptance_outcome)
          values ('candidate','project','run','rival.com',0,'https://rival.com/','Private excerpt','hash',2,'legacy_read_site','verified','Rival','Private rationale',1,'Rival','Private notes','added');
        insert into project_competitors (id,project_id,domain,name,notes,updated_at,updated_by)
          values ('canonical','project','rival.com','Rival','Private notes','2026-11-03T00:00:00.000Z','user');
        update project_competitor_research_candidates set canonical_competitor_id='canonical',canonical_inserted_at='2026-11-03T00:00:00.000Z' where id='candidate';
        insert into project_website_research_attempts
          (id,project_id,organization_id,mode,surface,sponsor_user_id,sponsor_member_id,sponsor_role,request_hash,admission_token,requested_website,requested_domain,snapshot_domain,location_code,language_code,context_version,context_hash,run_seeded_tracking,competitor_run_id,state,created_at_ms,deadline_at_ms,finished_at_ms,review_snapshot_json,review_hash)
          values ('attempt','project','organization','direct','web','user','membership','owner','hash','nonce','https://example.com/private','example.com','example.com',2840,'en',0,'contexthash',0,'run','review_ready',1,1000,2,'{"overview":"Private review"}','reviewhash');
        delete from member where id='membership';
      `);
      const db = drizzle(testDb.pg);
      const user = {
        id: "user",
        email: "authority@example.com",
        name: "User",
      };
      const inventory = await buildInventory(db, user);
      expect(inventory.organizations).toEqual([]);
      expect(inventory.databaseCounts).toMatchObject({
        sponsored_competitor_runs: 1,
        sponsored_website_attempts: 1,
        sponsored_competitor_candidates: 1,
      });
      expect(inventory.activeAiVisibilityWorkflowIds).not.toContain(
        "ai-research-setup-project",
      );
      const receipt = await erasePostgres(db, user, []);
      await verifyPostgres(db, user.id, [], receipt);
      expect(
        await testDb.execute("select id from projects where id='project'"),
      ).toHaveLength(1);
      expect(
        await testDb.execute(
          "select id from project_competitors where id='canonical'",
        ),
      ).toHaveLength(0);
      expect(
        await testDb.execute(
          "select cost_usd from project_competitor_research_operations where id='operation'",
        ),
      ).toMatchObject([{ cost_usd: 0.03 }]);
      expect(
        await testDb.execute(
          "select billing_state from project_competitor_research_runs where id='run'",
        ),
      ).toMatchObject([{ billing_state: "unknown" }]);
    });

    it("cascades research with a solo organization", async () => {
      if (!testDb.pg) throw new Error("PostgreSQL fixture required");
      await seedPrivateRun();
      const db = drizzle(testDb.pg);
      const receipt = await erasePostgres(
        db,
        { id: "user", email: "authority@example.com", name: "User" },
        ["organization"],
      );
      await verifyPostgres(db, "user", ["organization"], receipt);
      expect(
        await testDb.execute(
          "select id from project_competitor_research_runs where id='private-run'",
        ),
      ).toHaveLength(0);
      expect(
        await testDb.execute(
          "select id from project_competitor_research_candidates where id='private-candidate'",
        ),
      ).toHaveLength(0);
    });

    it("rolls back competitor redaction if a solo organization gained another member", async () => {
      if (!testDb.pg) throw new Error("PostgreSQL fixture required");
      await seedPrivateRun();
      await testDb.executeMultiple(`
        insert into "user" (id,name,email,created_at,updated_at) values ('other','Other','other@example.com',now(),now());
        insert into member (id,organization_id,user_id,role,created_at) values ('other-member','organization','other','member',now());
      `);
      await expect(
        erasePostgres(
          drizzle(testDb.pg),
          { id: "user", email: "authority@example.com", name: "User" },
          ["organization"],
        ),
      ).rejects.toThrow("gained other members");
      expect(
        await testDb.execute(
          "select business_summary from project_competitor_research_runs where id='private-run'",
        ),
      ).toMatchObject([{ business_summary: "Private business" }]);
      expect(
        await testDb.execute(
          "select source_excerpt from project_competitor_research_candidates where id='private-candidate'",
        ),
      ).toMatchObject([{ source_excerpt: "Private excerpt" }]);
    });
  },
);
