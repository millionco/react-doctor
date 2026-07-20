// rule: no-side-tab-border
// weakness: component-role
// source: PR #1337 all-rules RDE parity (PostHog/posthog, Infisical/infisical)
export const LoadingSpinner = () => (
  <div className="animate-spin rounded-full border-b-2 border-blue-600" />
);
