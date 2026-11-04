import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest();

/** Compares digests, so neither the content nor the length leaks by timing. */
export function isAuthorized(header, token) {
  const presented =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : "";
  return timingSafeEqual(digest(presented), digest(token));
}
