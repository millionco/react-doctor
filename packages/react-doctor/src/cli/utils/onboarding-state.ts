import Conf from "conf";
import { REACT_DOCTOR_CONFIG_PROJECT_NAME } from "./constants.js";

const ONBOARDED_AT_KEY = "onboardedAt";

export interface OnboardingStoreOptions {
  // Overrides the config dir; tests point this at a temp dir.
  readonly cwd?: string;
}

interface OnboardingGlobalConfig {
  // ISO timestamp of the first onboarding reveal; its presence means onboarded.
  readonly [ONBOARDED_AT_KEY]?: string;
}

const getOnboardingStore = (options: OnboardingStoreOptions = {}): Conf<OnboardingGlobalConfig> =>
  new Conf<OnboardingGlobalConfig>({
    projectName: REACT_DOCTOR_CONFIG_PROJECT_NAME,
    cwd: options.cwd,
  });

export const getOnboardingConfigPath = (options: OnboardingStoreOptions = {}): string =>
  getOnboardingStore(options).path;

export const hasCompletedOnboarding = (options: OnboardingStoreOptions = {}): boolean => {
  try {
    return typeof getOnboardingStore(options).get(ONBOARDED_AT_KEY) === "string";
  } catch {
    // Fail safe to "already onboarded" if the store is unreadable.
    return true;
  }
};

export const markOnboardingComplete = (options: OnboardingStoreOptions = {}): void => {
  try {
    const store = getOnboardingStore(options);
    if (typeof store.get(ONBOARDED_AT_KEY) === "string") return;
    store.set(ONBOARDED_AT_KEY, new Date().toISOString());
  } catch {
    // Best-effort: persisting the marker must never break a scan.
  }
};
