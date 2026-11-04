import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organization, user } from "./better-auth-schema";

export const userOnboardingAnswers = sqliteTable(
  "user_onboarding_answers",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    interestedFeatures: text("interested_features").notNull().default("[]"),
    workFor: text("work_for"),
    clientWebsiteCount: text("client_website_count"),
    foundVia: text("found_via"),
    mcpSetupIntent: text("mcp_setup_intent"),
    completedAt: text("completed_at"),
    // Set when the user resolves the Search Console ask, either in current
    // onboarding or via the one-time re-engagement nudge for legacy users.
    // Null = not yet shown/resolved.
    gscNudgeDismissedAt: text("gsc_nudge_dismissed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("user_onboarding_answers_organization_idx").on(table.organizationId),
  ],
);

// The paid-social ad (utm_medium=paid_social) a hosted signup came from, read
// from the UTM tags the marketing site carries onto the sign-up link.
// Campaign-level tags only: no click ids or other per-person ad identifiers.
// No row = not from a paid-social ad.
export const userSignupCampaigns = sqliteTable("user_signup_campaigns", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  utmSource: text("utm_source"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
});
