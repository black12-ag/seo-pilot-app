import { integer, pgTable, text } from "drizzle-orm/pg-core";

// See ../free-backlinks.schema.ts.
export const freeBacklinkProfiles = pgTable("free_backlink_profiles", {
  domain: text("domain").primaryKey(),
  release: text("release").notNull(),
  publishedAt: text("published_at"),
  referringDomains: integer("referring_domains").notNull(),
  referrers: text("referrers").notNull(),
  importedAt: text("imported_at").notNull(),
});
