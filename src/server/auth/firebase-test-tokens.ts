import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeJwt, importPKCS8, SignJWT, type JWTPayload } from "jose";
import { vi } from "vitest";
import { z } from "zod";

export async function createFirebaseTestTokens() {
  const directory = mkdtempSync(join(tmpdir(), "seo-firebase-fixture-"));
  const keyFile = join(directory, "key.pem");
  const certFile = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-days",
      "1",
      "-subj",
      "/CN=synthetic-firebase-test",
    ],
    { stdio: "ignore" },
  );
  const key = await importPKCS8(readFileSync(keyFile, "utf8"), "RS256");
  const certificate = readFileSync(certFile, "utf8");
  // Nothing synthetic is left on disk once the signing objects exist.
  rmSync(directory, { recursive: true, force: true });
  const kid = crypto.randomUUID();
  async function token(overrides: JWTPayload = {}) {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      iss: "https://securetoken.google.com/test-firebase",
      aud: "test-firebase",
      sub: "firebase-owner",
      email: "owner@example.com",
      email_verified: true,
      name: "Google Owner",
      iat: now,
      auth_time: now,
      exp: now + 3_600,
      firebase: { sign_in_provider: "google.com" },
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid })
      .sign(key);
  }
  function mockNetwork(status: Record<string, unknown> = {}) {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (
          url ===
          "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
        ) {
          return Response.json(
            { [kid]: certificate },
            { headers: { "cache-control": "max-age=0" } },
          );
        }
        if (
          url.startsWith(
            "https://identitytoolkit.googleapis.com/v1/accounts:lookup?",
          )
        ) {
          if (typeof init?.body !== "string")
            throw new Error("Expected token JSON body");
          const body = z
            .object({ idToken: z.string() })
            .parse(JSON.parse(init.body));
          const claims = decodeJwt(body.idToken);
          return Response.json({
            users: [
              {
                localId: claims.sub,
                email: claims.email,
                emailVerified: true,
                ...status,
              },
            ],
          });
        }
        throw new Error("Unexpected network request in Firebase test");
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  return { token, mockNetwork };
}
