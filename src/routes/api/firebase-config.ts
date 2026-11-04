import { createFileRoute } from "@tanstack/react-router";
import { getFirebaseConfig } from "@/server/auth/firebase-token";

export const Route = createFileRoute("/api/firebase-config")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { config: getFirebaseConfig() },
          { headers: { "cache-control": "no-store" } },
        ),
    },
  },
});
