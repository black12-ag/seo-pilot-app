import { z } from "zod";
import { getAuthMode } from "@/lib/auth-mode";

export const hostedBaseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  }, "BETTER_AUTH_URL must use https or a loopback host");

type SocialAuthEnvironment = {
  AUTH_MODE?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export function getSocialProviders(env: SocialAuthEnvironment) {
  const mode = getAuthMode(env.AUTH_MODE);
  if (mode !== "hosted") return {};
  return { google: getGoogleSocialProviderConfig(env) };
}

export function getGoogleSocialProviderConfig(env: SocialAuthEnvironment) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is required in hosted mode");
  if (!clientSecret)
    throw new Error("GOOGLE_CLIENT_SECRET is required in hosted mode");
  return {
    clientId,
    clientSecret,
    mapProfileToUser: (profile: { name?: string }) => ({ name: profile.name }),
  };
}

function getTrustedOrigins(baseUrl: string) {
  const trustedOrigins = [baseUrl];

  if (process.env.NODE_ENV !== "production") {
    trustedOrigins.push(
      "http://open-seo.localhost:1355",
      "http://*.open-seo.localhost:1355",
      "https://open-seo.localhost:1355",
      "https://*.open-seo.localhost:1355",
    );
  }

  return trustedOrigins;
}

export function getSocialRedirectConfig(baseUrl: string) {
  return {
    // Keep consent cancellation and callback failures on the auth error page.
    onAPIError: { errorURL: `${baseUrl}/auth-error` },
    trustedOrigins: getTrustedOrigins(baseUrl),
  };
}
