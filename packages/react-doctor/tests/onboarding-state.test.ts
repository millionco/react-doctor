import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import {
  getOnboardingConfigPath,
  hasCompletedOnboarding,
  markOnboardingComplete,
} from "../src/cli/utils/onboarding-state.js";
import {
  disableSetupPrompt,
  getSetupPromptConfigPath,
  hasDisabledSetupPrompt,
} from "../src/cli/utils/prompt-install-setup.js";

describe("onboarding state", () => {
  let configRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-onboarding-"));
    configRoot = root;
    cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("reports not-onboarded before the first run", () => {
    expect(hasCompletedOnboarding({ cwd: configRoot })).toBe(false);
  });

  it("marks onboarding complete so later runs skip the reveal", () => {
    markOnboardingComplete({ cwd: configRoot });
    expect(hasCompletedOnboarding({ cwd: configRoot })).toBe(true);
  });

  it("keeps the first-run timestamp stable across repeated marks", () => {
    markOnboardingComplete({ cwd: configRoot });
    const firstStamp = JSON.parse(
      fs.readFileSync(getOnboardingConfigPath({ cwd: configRoot }), "utf8"),
    ).onboardedAt;

    markOnboardingComplete({ cwd: configRoot });
    const secondStamp = JSON.parse(
      fs.readFileSync(getOnboardingConfigPath({ cwd: configRoot }), "utf8"),
    ).onboardedAt;

    expect(typeof firstStamp).toBe("string");
    expect(secondStamp).toBe(firstStamp);
  });

  it("shares one config file with setup-prompt state without clobbering it", () => {
    const projectRoot = path.join(configRoot, "project");
    disableSetupPrompt(projectRoot, { cwd: configRoot });
    markOnboardingComplete({ cwd: configRoot });

    expect(getOnboardingConfigPath({ cwd: configRoot })).toBe(
      getSetupPromptConfigPath({ cwd: configRoot }),
    );
    expect(hasDisabledSetupPrompt(projectRoot, { cwd: configRoot })).toBe(true);
    expect(hasCompletedOnboarding({ cwd: configRoot })).toBe(true);
  });
});
