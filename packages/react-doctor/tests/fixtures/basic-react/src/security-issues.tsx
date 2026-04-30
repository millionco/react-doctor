// Use a fixture-only token shape that intentionally avoids the real Stripe
// `sk_live_*` prefix so secret scanners (TruffleHog, GitGuardian, GitHub) do
// not flag this file in source. The plugin still reports it via the
// variable-name + length heuristic (`apiKey` + 16+ chars).
const apiKey = "fixture_token_1234567890abcdef";

const SecretDisplay = () => <div>{apiKey}</div>;

export { SecretDisplay };
