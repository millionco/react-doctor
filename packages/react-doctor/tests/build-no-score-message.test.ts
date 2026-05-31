import { describe, expect, it } from "vite-plus/test";
import { ENTERPRISE_CONTACT_URL } from "@react-doctor/core";
import { buildNoScoreMessage } from "../src/cli/utils/build-no-score-message.js";

describe("buildNoScoreMessage", () => {
  it("points --no-score users to enterprise contact", () => {
    expect(buildNoScoreMessage(true)).toBe(
      `Score disabled by --no-score. Want something custom to your company? Contact us at ${ENTERPRISE_CONTACT_URL}.`,
    );
  });

  it("points score API failures to enterprise contact", () => {
    expect(buildNoScoreMessage(false)).toBe(
      `Score unavailable (could not reach the score API). Want something custom to your company? Contact us at ${ENTERPRISE_CONTACT_URL}.`,
    );
  });
});
