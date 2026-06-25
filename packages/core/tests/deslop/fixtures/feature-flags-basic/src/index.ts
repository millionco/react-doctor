import { useGate } from "statsig-react";
import { variation } from "launchdarkly-js-client-sdk";

export const handler = (): string => {
  if (process.env.FEATURE_NEW_CHECKOUT === "true") {
    return "new-checkout";
  }
  if (useGate("legacy_billing").value) {
    return "legacy";
  }
  return variation("payments-flag", "default");
};
