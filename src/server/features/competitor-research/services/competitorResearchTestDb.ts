import { createSiteAuthorityTestDb } from "../../site-authority/siteAuthorityTestDb";

export const COMPETITOR_TEST_PROJECT_ID =
  "11111111-1111-4111-8111-111111111111";

export async function createCompetitorResearchTestDb() {
  return createSiteAuthorityTestDb();
}

export async function seedCompetitorProject(
  db: Awaited<ReturnType<typeof createSiteAuthorityTestDb>>,
) {
  await db.seedProject();
  await db.execute(
    `update projects set id='${COMPETITOR_TEST_PROJECT_ID}', legacy_setup_absence_proven=1 where id='project'`,
  );
}
