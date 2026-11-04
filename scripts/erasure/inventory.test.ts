import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildInventory } from "./inventory";

const { testDb } = await vi.hoisted(async () => {
  const { createSiteAuthorityTestDb } =
    await import("../../src/server/features/site-authority/siteAuthorityTestDb");
  return { testDb: await createSiteAuthorityTestDb() };
});
beforeEach(testDb.seedProject);
afterAll(testDb.close);

describe.skipIf(testDb.provider !== "postgres")("erasure inventory", () => {
  it("counts attributed content and refuses a currently shared organization", async () => {
    if (!testDb.pg) throw new Error("PostgreSQL fixture required");
    await testDb.executeMultiple(`
      INSERT INTO content_mutations (id,project_id,mutation_id,request_hash,kind,result_id,completed,created_at_ms) VALUES ('receipt','project','capture','hash','capture','source',1,1);
      INSERT INTO content_sources (id,project_id,mutation_receipt_id,kind,title,attribution,source_text,text_hash,captured_at_ms,extraction_method,extraction_version,extraction_status,created_by_user_id) VALUES ('source','project','receipt','web','Title','Owner','Text','hash',1,'public_html_text','public-source-v1','usable','user');
      INSERT INTO content_source_url_captures VALUES ('source','project','https://example.com/',null,null,0,0,0,0,4);
      INSERT INTO wordpress_connections (project_id,origin,credential_id,sealed_credential,read_status,write_status,created_by_user_id,created_at_ms,updated_at_ms) VALUES ('project','https://example.com','credential','sealed','granted','granted','user',1,1);
    `);
    const db = drizzle(testDb.pg);
    const user = { id: "user", name: "User", email: "authority@example.com" };
    expect((await buildInventory(db, user)).databaseCounts).toMatchObject({
      content_sources: 1,
      content_source_url_captures: 1,
      attributed_content_sources: 1,
      wordpress_connections: 1,
    });
    await testDb.executeMultiple(`
      INSERT INTO "user" (id,name,email,created_at,updated_at) VALUES ('other','Other','other@example.com',now(),now());
      INSERT INTO member (id,organization_id,user_id,role,created_at) VALUES ('other-member','organization','other','member',now());
    `);
    await expect(buildInventory(db, user)).rejects.toThrow(
      "Refusing to erase shared organization",
    );
  });

  it("finds only a departed sponsor's active competitor and setup workflow IDs", async () => {
    if (!testDb.pg) throw new Error("PostgreSQL fixture required");
    await testDb.executeMultiple(`
      insert into "user" (id,name,email,created_at,updated_at) values ('other','Other','other@example.com',now(),now());
      insert into member (id,organization_id,user_id,role,created_at) values ('other-member','organization','other','owner',now());
      insert into project_competitor_research_runs
        (id,project_id,organization_id,admission_token,request_id,request_hash,origin,state,active_project_id,sponsor_user_id,sponsor_member_id,sponsor_role,surface,model_configuration_hash,domain,location_code,language_code,context_version,context_hash,business_summary,limits_profile,created_at_ms,deadline_at_ms,billing_state)
        values ('active-run','project','organization','nonce','request','hash','explicit','queued','project','user','membership','owner','web','modelhash','example.com',2840,'en',0,'contexthash','Business','competitor-discovery-v1',1,1000,'not_started');
      insert into project_website_research_attempts
        (id,project_id,organization_id,mode,surface,sponsor_user_id,sponsor_member_id,sponsor_role,request_hash,admission_token,execution_token,requested_website,requested_domain,snapshot_domain,location_code,language_code,context_version,context_hash,run_seeded_tracking,state,active_project_id,created_at_ms,started_at_ms,deadline_at_ms)
        values ('active-attempt','project','organization','ai_setup','web','user','membership','owner','hash','nonce','execution','https://example.com','example.com','example.com',2840,'en',0,'contexthash',1,'running','project',1,2,1000);
      delete from member where id='membership';
    `);
    const inventory = await buildInventory(drizzle(testDb.pg), {
      id: "user",
      name: "User",
      email: "authority@example.com",
    });
    expect(inventory.organizations).toEqual([]);
    expect(inventory.aiVisibilityProjectIds).toEqual([]);
    expect(inventory.activeAiVisibilityWorkflowIds).toEqual([
      "competitor-research-active-run",
      "ai-research-setup-active-attempt",
    ]);
  });
});
