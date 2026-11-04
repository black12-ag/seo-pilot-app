import { describe, expect, it } from "vitest";
import { getSocialProviders, getSocialRedirectConfig } from "./auth-social";

describe("hosted social configuration", () => {
  it.each(["password", "everyapp", "cloudflare_access", "local_noauth"])(
    "does not enable native Google in %s mode, even with credentials",
    (AUTH_MODE) => {
      expect(
        getSocialProviders({
          AUTH_MODE,
          GOOGLE_CLIENT_ID: "configured-client",
          GOOGLE_CLIENT_SECRET: "configured-secret",
        }),
      ).toEqual({});
      expect(getSocialProviders({ AUTH_MODE })).toEqual({});
    },
  );

  it("retains hosted credential requirements", () => {
    expect(() => getSocialProviders({ AUTH_MODE: "hosted" })).toThrow(
      "GOOGLE_CLIENT_ID is required in hosted mode",
    );
    expect(() =>
      getSocialProviders({ AUTH_MODE: "hosted", GOOGLE_CLIENT_ID: "client" }),
    ).toThrow("GOOGLE_CLIENT_SECRET is required in hosted mode");
  });

  it("retains hosted profile mapping and basic default scopes", () => {
    const providers = getSocialProviders({
      AUTH_MODE: "hosted",
      GOOGLE_CLIENT_ID: " client ",
      GOOGLE_CLIENT_SECRET: " secret ",
    });
    expect(providers.google).toMatchObject({
      clientId: "client",
      clientSecret: "secret",
    });
    expect(
      providers.google?.mapProfileToUser({ name: "Existing Name" }),
    ).toEqual({
      name: "Existing Name",
    });
    expect(providers.google).not.toHaveProperty("scope");
    expect(providers.google).not.toHaveProperty("getUserInfo");
  });

  it("keeps callback failures and trusted origins on the configured app", () => {
    const config = getSocialRedirectConfig("https://seo.example.com");
    expect(config.onAPIError.errorURL).toBe(
      "https://seo.example.com/auth-error",
    );
    expect(config.trustedOrigins[0]).toBe("https://seo.example.com");
  });
});
