import type { CiProvider, CiProviderId } from "./ci-provider.js";
import { githubActionsProvider } from "./github-actions-provider.js";
import { gitlabCiProvider } from "./gitlab-ci-provider.js";

// GitHub Actions leads because it's the fully supported backend (and the one
// the overwhelming majority of repos use); GitLab is the gate-only fallback.
export const CI_PROVIDERS: ReadonlyArray<CiProvider> = [githubActionsProvider, gitlabCiProvider];

export const isCiProviderId = (value: string): value is CiProviderId =>
  CI_PROVIDERS.some((provider) => provider.id === value);

export const getCiProvider = (id: CiProviderId): CiProvider => {
  const provider = CI_PROVIDERS.find((candidate) => candidate.id === id);
  // Unreachable for a validated id; the throw makes the non-null return honest.
  if (!provider) throw new Error(`Unknown CI provider: ${id}`);
  return provider;
};
