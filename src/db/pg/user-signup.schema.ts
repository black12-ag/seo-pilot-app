import { sql } from "drizzle-orm";
import { index, pgTable, text } from "drizzle-orm/pg-core";
import { organization, user } from "./better-auth-schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestampColumn = (name: string) => text(name);

export const userOnboardingAnswers = pgTable(
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
    completedAt: timestampColumn("completed_at"),
    // Set when the user dismisses (or acts on) the one-time "connect Search
    // Console" nudge shown to people who finished onboarding before the GSC
    // step existed. Null = never shown/dismissed.
    gscNudgeDismissedAt: timestampColumn("gsc_nudge_dismissed_at"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    index("user_onboarding_answers_organization_idx").on(table.organizationId),
  ],
);

// The paid-social ad (utm_medium=paid_social) a hosted signup came from, read
// from the UTM tags the marketing site carries onto the sign-up link.
// Campaign-level tags only: no click ids or other per-person ad identifiers.
// No row = not from a paid-social ad.
export const userSignupCampaigns = pgTable("user_signup_campaigns", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  utmSource: text("utm_source"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
});
