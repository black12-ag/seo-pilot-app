import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { signUpStatusQueryOptions } from "./signUpStatus";
afterEach(() => vi.unstubAllGlobals());
it("takes Google visibility from server booleans and rejects guessed values", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ firstAccount: false, googleSignIn: true }),
      ),
  );
  expect(
    await new QueryClient().fetchQuery(signUpStatusQueryOptions()),
  ).toEqual({ firstAccount: false, googleSignIn: true });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ firstAccount: false, googleSignIn: "configured" }),
      ),
  );
  await expect(
    new QueryClient().fetchQuery({
      ...signUpStatusQueryOptions(),
      retry: false,
    }),
  ).rejects.toThrow();
});
