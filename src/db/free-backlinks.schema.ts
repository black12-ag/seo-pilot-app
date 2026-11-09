import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Free, domain-level backlink data from Common Crawl's public web graph, one
// row per tracked domain (a project site or a competitor). It is public data
// about the domain, not about an organization, so the row is keyed by domain;
// reads only answer for domains the asking project tracks.
// Written by scripts/celld/runtime/free-backlinks.mjs; see docs/FREE_BACKLINKS.md.
export const freeBacklinkProfiles = sqliteTable("free_backlink_profiles", {
  // Registrable domain, lowercase (example.com, example.co.uk).
  domain: text("domain").primaryKey(),
  // Web graph release name, e.g. cc-main-2026-aug-sep-oct.
  release: text("release").notNull(),
  // When Common Crawl published that release (ISO), if known.
  publishedAt: text("published_at"),
  // Every linking domain the graph has, not just the stored ones.
  referringDomains: integer("referring_domains").notNull(),
  // JSON array of [domain, hosts] pairs, most hosts first, capped by the script.
  referrers: text("referrers").notNull(),
  importedAt: text("imported_at").notNull(),
});
