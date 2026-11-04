import { beforeEach, describe, expect, it, vi } from "vitest";

const { check, track } = vi.hoisted(() => ({ check: vi.fn(), track: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { KV: {} } }));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: vi.fn(),
}));
vi.mock("@/server/lib/posthog", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/server/email/onboarding-drip", () => ({
  sendCreditsExhaustedEvent: vi.fn(),
}));
vi.mock("@/server/billing/autumn", () => ({
  autumn: { check, track },
  AUTUMN_TRACK_RETRY_OPTIONS: {},
}));

import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { billResearchSpend, type ResearchSpend } from "./researchSpend";

const customer = {
  organizationId: "org",
  userId: "user",
  userEmail: "user@example.com",
};
const spend: ResearchSpend[] = [
  {
    provider: "dataforseo",
    creditFeature: "keyword_research",
    operation: "serp",
    costUsd: 0.01,
  },
];

describe("research settlement", () => {
  beforeEach(() => {
    vi.mocked(isHostedServerAuthMode).mockResolvedValue(true);
    check.mockResolvedValue({
      allowed: true,
      balance: { remaining: 1000 },
    });
    track.mockResolvedValue({
      customerId: "org",
      value: 10,
    });
  });

  it("reports no submission needed for no positive spend", async () => {
    await expect(billResearchSpend(customer, [])).resolves.toEqual({
      status: "not_required",
    });
    expect(isHostedServerAuthMode).not.toHaveBeenCalled();
  });

  it("reports external spend for self-hosted research without Autumn billing", async () => {
    vi.mocked(isHostedServerAuthMode).mockResolvedValue(false);
    await expect(billResearchSpend(customer, spend)).resolves.toEqual({
      status: "selfhost_external",
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("keeps hosted settlement unknown even when track resolves, because it can fail open", async () => {
    await expect(billResearchSpend(customer, spend)).resolves.toEqual({
      status: "unknown",
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "org" }),
      expect.anything(),
    );
  });

  it("does not retry or throw when tracking fails or its reply is lost", async () => {
    track.mockRejectedValue(new Error("lost reply"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(billResearchSpend(customer, spend)).resolves.toEqual({
        status: "unknown",
      });
      expect(track).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });

  it("reports unknown after a later charge fails without replaying the first", async () => {
    track
      .mockResolvedValueOnce({ customerId: "org", value: 10 })
      .mockRejectedValueOnce(new Error("lost reply"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        billResearchSpend(customer, [...spend, ...spend]),
      ).resolves.toEqual({
        status: "unknown",
      });
      expect(track).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
});
