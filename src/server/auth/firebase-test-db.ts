import { createSiteAuthorityTestDb } from "@/server/features/site-authority/siteAuthorityTestDb";

// Reuse the house migration-applied SQLite / disposable PostgreSQL harness.
export async function createFirebaseTestDb() {
  const testDb = await createSiteAuthorityTestDb();
  const environment = {
    AUTH_MODE: "password" as const,
    DATABASE_PROVIDER: testDb.provider,
    BETTER_AUTH_URL: "https://seo.example.com",
    BETTER_AUTH_SECRET: "synthetic-test-auth-secret-at-least-32-characters",
    FIREBASE_PROJECT_ID: "test-firebase",
    FIREBASE_AUTH_DOMAIN: "test-firebase.firebaseapp.com",
    FIREBASE_API_KEY: "synthetic-public-api-key",
    FIREBASE_APP_ID: "synthetic-app-id",
  };
  return { ...testDb, environment };
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export function createFirebaseTestClient(
  handler: (request: Request) => Promise<Response>,
) {
  let requestNumber = 0;
  function request(
    path: string,
    body?: unknown,
    cookie?: string,
    origin = "https://seo.example.com",
  ) {
    return handler(
      new Request(`https://seo.example.com/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "x-real-ip": `192.0.2.${++requestNumber}`,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  return { request, cookies };
}
