import { describe, expect, it } from "vitest";
import { publicHomeRedirect } from "./publicHome";

const home = (cookie?: string, method = "GET") =>
  new Request("https://seo.example.com/", {
    method,
    headers: cookie ? { cookie } : {},
  });

describe("publicHomeRedirect", () => {
  it("sends a visitor with no session from / to the landing page", () => {
    const response = publicHomeRedirect(
      home(),
      "https://seo.example.com/",
      "password",
    );
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/welcome");
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("lets a signed-in person through to the app", () => {
    for (const cookie of [
      "better-auth.session_token=abc",
      "theme=dark; __Secure-better-auth.session_token=abc",
    ]) {
      expect(
        publicHomeRedirect(
          home(cookie),
          "https://seo.example.com/",
          "password",
        ),
      ).toBeNull();
    }
  });

  it("leaves other paths, methods and auth modes alone", () => {
    expect(
      publicHomeRedirect(
        home(),
        "https://seo.example.com/projects",
        "password",
      ),
    ).toBeNull();
    expect(
      publicHomeRedirect(
        home(undefined, "POST"),
        "https://seo.example.com/",
        "password",
      ),
    ).toBeNull();
    for (const mode of ["local_noauth", "hosted", "everyapp"]) {
      expect(
        publicHomeRedirect(home(), "https://seo.example.com/", mode),
      ).toBeNull();
    }
  });
});
