// rule: no-presentation-role-conflict
// weakness: compatible-aria-state
// source: PR #1337 all-rules RDE parity (PostHog/posthog, payloadcms/payload)
export const DecorativeLogo = () => <img alt="" aria-hidden="true" src="logo.svg" />;
