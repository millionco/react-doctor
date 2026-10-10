import { describe, expect, it, vi } from "vite-plus/test";

import {
  CODE_GRADING_FIREWALL_BUCKET_KEY,
  CODE_GRADING_FIREWALL_RULE_ID,
} from "../src/constants.js";
import { createVercelGradingAdmission } from "../src/utils/create-vercel-grading-admission.js";

interface MissingFirewallRule {
  rateLimited: boolean;
  error: "not-found";
}

describe("Vercel grading admission", () => {
  it("uses a fixed host and account bucket without client headers", async () => {
    const check = vi.fn(async () => ({ rateLimited: false }));
    const admit = createVercelGradingAdmission({ host: "grader.vercel.app", check });
    expect(await admit()).toEqual({ status: "allowed" });
    expect(check).toHaveBeenCalledWith(CODE_GRADING_FIREWALL_RULE_ID, {
      headers: new Headers({ host: "grader.vercel.app" }),
      rateLimitKey: CODE_GRADING_FIREWALL_BUCKET_KEY,
    });
    expect(() => createVercelGradingAdmission({ host: "attacker.test/path" })).toThrow();
  });

  it("keeps quota rejection separate from a missing or blocked rule", async () => {
    const limited = createVercelGradingAdmission({
      host: "grader.vercel.app",
      check: async () => ({ rateLimited: true }),
    });
    expect(await limited()).toEqual({ status: "limited" });
    const blocked = createVercelGradingAdmission({
      host: "grader.vercel.app",
      check: async () => ({ rateLimited: true, error: "blocked" }),
    });
    expect(await blocked()).toEqual({ status: "limited" });
    const check = vi.fn(
      async (): Promise<MissingFirewallRule> => ({
        rateLimited: false,
        error: "not-found",
      }),
    );
    const missing = createVercelGradingAdmission({ host: "grader.vercel.app", check });
    expect(await missing()).toEqual({ status: "unavailable" });
    expect(await missing()).toEqual({ status: "unavailable" });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("fails closed after a stalled check without accumulating background requests", async () => {
    const check = vi.fn(() => new Promise<{ rateLimited: boolean }>(() => {}));
    const admit = createVercelGradingAdmission({
      host: "grader.vercel.app",
      timeoutMs: 5,
      check,
    });
    expect(await admit()).toEqual({ status: "unavailable" });
    expect(await admit()).toEqual({ status: "unavailable" });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the firewall rejects its request", async () => {
    const admit = createVercelGradingAdmission({
      host: "grader.vercel.app",
      check: async () => {
        throw new Error("Network unavailable");
      },
    });
    expect(await admit()).toEqual({ status: "unavailable" });
  });
});
