import { checkRateLimit } from "@vercel/firewall";

import {
  CODE_GRADING_FIREWALL_BUCKET_KEY,
  CODE_GRADING_FIREWALL_RULE_ID,
  CODE_GRADING_FIREWALL_TIMEOUT_MS,
} from "../constants.js";
import type { CodeGradingAdmission } from "../create-code-grading-server.js";
import { waitWithAbort } from "./wait-with-abort.js";

interface VercelGradingAdmissionOptions {
  host: string;
  check?: typeof checkRateLimit;
  timeoutMs?: number;
}

export const createVercelGradingAdmission = (options: VercelGradingAdmissionOptions) => {
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.vercel\.app$/i.test(options.host))
    throw new TypeError("Use the project's Vercel production hostname for the firewall");
  const check = options.check ?? checkRateLimit;
  let unavailable = false;
  return async (): Promise<CodeGradingAdmission> => {
    if (unavailable) return { status: "unavailable" };
    try {
      const result = await waitWithAbort(
        check(CODE_GRADING_FIREWALL_RULE_ID, {
          headers: new Headers({ host: options.host }),
          rateLimitKey: CODE_GRADING_FIREWALL_BUCKET_KEY,
        }),
        AbortSignal.timeout(options.timeoutMs ?? CODE_GRADING_FIREWALL_TIMEOUT_MS),
      );
      if (result.error === "not-found") {
        unavailable = true;
        return { status: "unavailable" };
      }
      return { status: result.rateLimited || result.error ? "limited" : "allowed" };
    } catch {
      unavailable = true;
      return { status: "unavailable" };
    }
  };
};
