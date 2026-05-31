import { GENERIC_SECRET_MIN_ENTROPY_BITS, GENERIC_SECRET_MIN_LENGTH_CHARS } from "../constants.js";

export const REDACTED_PLACEHOLDER = "<redacted>";

interface RedactionRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

// Provider tokens carry a non-secret, type-identifying prefix (e.g.
// `sk_live_`, `ghp_`, `AKIA`). Keeping that prefix visible while masking
// the secret material makes a diagnostic actionable — you can see *which*
// credential type leaked and from which environment — without echoing the
// secret itself. Prefixed rules capture the prefix as group 1 and use
// this replacement; `$1` re-emits the prefix and the body becomes the
// inert placeholder, e.g. `sk_live_<redacted>`.
const KEEP_PREFIX = `$1${REDACTED_PLACEHOLDER}`;

// High-precision detectors for credentials and PII that can ride along
// inside a diagnostic's `message` / `help` when a rule echoes a source
// fragment (e.g. `useState("sk-live-…")`). Shapes track the corpora that
// gitleaks and secretlint maintain, so coverage stays close to the
// ecosystem's without taking either as a runtime dependency — this is a
// synchronous, in-string backstop on a hot path, not a file scanner.
//
// Ordered so structured composites (key blocks, JWTs, credentialed URLs)
// run before the narrower prefixed tokens, every replacement leaves only
// inert `<redacted>` text that no later rule can re-match (the prefix kept
// by `KEEP_PREFIX` is always too short and followed by `<`, so neither the
// prefixed rules nor the entropy sweep re-trigger), and the broad entropy
// sweep (`redactHighEntropyTokens`) runs dead last. Each pattern is
// intentionally narrow — it targets a real secret shape, never an ordinary
// identifier — and uses linear-time constructs (no nested or overlapping
// quantifiers) so a pathological message can't trigger catastrophic
// backtracking. Structural/unknown-format secrets with no meaningful
// prefix (PEM, JWT, credentialed URLs, Bearer values, emails, and the
// generic sweep) are masked whole. Token-body lengths are open-ended
// (`{N,}`, not `{N}`): a credential echoed longer than its canonical
// length must be masked whole, never leaving a trailing suffix the
// generic sweep is too short to catch.
const KNOWN_SECRET_RULES: readonly RedactionRule[] = [
  // PEM private key block (RSA / EC / OPENSSH / PGP / plain). `[A-Z ]*`
  // is a single linear class; the lazy body is bounded by the END marker.
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: REDACTED_PLACEHOLDER,
  },
  // JWT (`header.payload.signature`, base64url).
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: REDACTED_PLACEHOLDER,
  },
  // Credentials embedded in a URL authority (`scheme://user:pass@host`).
  // The lookbehind / lookahead keep the scheme and host so the location
  // stays useful while the `user:pass` pair is masked. The first colon
  // separates user from password; the password class allows further
  // colons (e.g. `user:p:a:ss@host`) so passwords with colons are still
  // fully masked rather than partially leaking.
  {
    pattern: /(?<=:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g,
    replacement: REDACTED_PLACEHOLDER,
  },
  // AWS access key id (all key-class prefixes, incl. temporary `ASIA`).
  // Length is open-ended (`{16,}`) rather than the canonical 16 so an
  // over-long run of key characters is masked whole instead of leaving a
  // trailing suffix that the generic sweep is too short to catch.
  {
    pattern: /\b(AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA|A3T[A-Z0-9])[0-9A-Z]{16,}/g,
    replacement: KEEP_PREFIX,
  },
  // GitHub tokens: classic/oauth/user/server/refresh (`gh[pousr]_`) and
  // fine-grained PATs (`github_pat_`).
  { pattern: /\b(gh[pousr]_)[A-Za-z0-9]{36,}/g, replacement: KEEP_PREFIX },
  { pattern: /\b(github_pat_)[A-Za-z0-9_]{22,}/g, replacement: KEEP_PREFIX },
  // GitLab personal access token.
  { pattern: /\b(glpat-)[A-Za-z0-9_-]{20,}/g, replacement: KEEP_PREFIX },
  // Slack bot/user/app tokens and incoming-webhook URLs.
  { pattern: /\b(xox[baprs]-)[A-Za-z0-9-]{10,}/g, replacement: KEEP_PREFIX },
  {
    pattern: /(?<=hooks\.slack\.com\/services\/)[A-Za-z0-9/+_-]{20,}/g,
    replacement: REDACTED_PLACEHOLDER,
  },
  // Stripe secret / restricted keys (publishable `pk_` left readable).
  { pattern: /\b((?:sk|rk)_(?:live|test)_)[0-9A-Za-z]{10,}/g, replacement: KEEP_PREFIX },
  // OpenAI / Anthropic style keys (`sk-`, `sk-proj-`, `sk-ant-…`).
  { pattern: /\b(sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}/g, replacement: KEEP_PREFIX },
  // Google API key and OAuth access token.
  { pattern: /\b(AIza)[0-9A-Za-z_-]{35,}/g, replacement: KEEP_PREFIX },
  { pattern: /\b(ya29\.)[0-9A-Za-z_-]{20,}/g, replacement: KEEP_PREFIX },
  // npm automation/publish token.
  { pattern: /\b(npm_)[A-Za-z0-9]{36,}/g, replacement: KEEP_PREFIX },
  // SendGrid API key.
  { pattern: /\b(SG\.)[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{43,}/g, replacement: KEEP_PREFIX },
  // Twilio API key SID.
  { pattern: /\b(SK)[0-9a-fA-F]{32,}/g, replacement: KEEP_PREFIX },
  // DigitalOcean personal access / OAuth token.
  { pattern: /\b(dop_v1_)[a-f0-9]{64,}/g, replacement: KEEP_PREFIX },
  // Shopify access tokens (admin/custom/private/shared-secret).
  { pattern: /\b(shp(?:at|ca|pa|ss)_)[a-fA-F0-9]{32,}/g, replacement: KEEP_PREFIX },
  // Square access / refresh token.
  { pattern: /\b(sq0[a-z]{3}-)[0-9A-Za-z_-]{22,}/g, replacement: KEEP_PREFIX },
  // Telegram bot token (`<id>:AA<secret>`). The `AA` anchor keeps the
  // numeric-id half from masking ordinary `digits:digits` text; the bot
  // id and `:AA` marker are kept as the prefix.
  { pattern: /\b([0-9]{8,10}:AA)[0-9A-Za-z_-]{32,}/g, replacement: KEEP_PREFIX },
  // Generic `Authorization: Bearer <token>` header value.
  { pattern: /(?<=\bBearer\s)[A-Za-z0-9._~+/=-]{16,}/g, replacement: REDACTED_PLACEHOLDER },
  // Email address (PII).
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: REDACTED_PLACEHOLDER,
  },
];

// Splits free text into contiguous `[A-Za-z0-9_-]` runs. `= + / : . @`
// and whitespace are natural delimiters, so a run can't bleed across a
// `name=value` separator and swallow an adjacent label. Linear: each
// character is visited once per `replace` pass.
const CANDIDATE_TOKEN_PATTERN = /[A-Za-z0-9_][A-Za-z0-9_-]*/g;

// Structured non-secret identifiers that clear the length/composition
// gates but are not credentials, so they're spared to keep diagnostics
// readable: canonical git object ids (SHA-1 / SHA-256, lowercase hex)
// and UUIDs. `-` stays in the token class so base64url secrets aren't
// fragmented, which means a UUID arrives here as one token rather than
// dash-split pieces — hence the explicit exclusion. The trade-off is
// that a bare secret of exactly these shapes slips the generic net,
// acceptable for a best-effort backstop (real provider secrets carry a
// prefix caught above).
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HAS_LETTER_PATTERN = /[A-Za-z]/;
const HAS_DIGIT_PATTERN = /[0-9]/;

// Shannon entropy in bits per character. Linear in token length.
const shannonEntropyBits = (value: string): number => {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    bits -= probability * Math.log2(probability);
  }
  return bits;
};

// A contiguous token long enough to be a credential, mixing letters and
// digits, that isn't a git object id and carries credential-like entropy.
// The length + composition + entropy gates together keep the sweep off
// ordinary long identifiers, repeated-character strings, and hashes.
const looksLikeHighEntropySecret = (token: string): boolean => {
  if (token.length < GENERIC_SECRET_MIN_LENGTH_CHARS) return false;
  if (!HAS_LETTER_PATTERN.test(token) || !HAS_DIGIT_PATTERN.test(token)) return false;
  if (GIT_OBJECT_ID_PATTERN.test(token) || UUID_PATTERN.test(token)) return false;
  return shannonEntropyBits(token) >= GENERIC_SECRET_MIN_ENTROPY_BITS;
};

const redactHighEntropyTokens = (text: string): string =>
  text.replace(CANDIDATE_TOKEN_PATTERN, (token) =>
    looksLikeHighEntropySecret(token) ? REDACTED_PLACEHOLDER : token,
  );

/**
 * Masks API keys, tokens, private keys, credentialed URLs, and emails
 * found anywhere inside a free-text string, returning the scrubbed text.
 * Applied to every diagnostic's `message` / `help` at construction time
 * so secrets never reach the terminal, the JSON report, or the score
 * API — react-doctor must never echo or transmit a user's secrets.
 *
 * Provider tokens keep their non-secret, type-identifying prefix (e.g.
 * `sk_live_<redacted>`, `ghp_<redacted>`, `AKIA<redacted>`) so the leaked
 * credential's type stays visible; structural or unknown-format secrets
 * with no meaningful prefix are masked whole.
 *
 * Runs the high-precision known-shape detectors first, then a generic
 * entropy-gated sweep for unknown-format secrets. Idempotent: the inert
 * `<redacted>` placeholder matches none of the detectors and is too
 * short for the generic sweep, so re-running leaves the text unchanged.
 *
 * Accepts `unknown` on purpose: callers feed it diagnostic `message` /
 * `help` that originate from oxlint JSON, which is only shape-checked at
 * the top level (the per-field `string` types are assumed, not validated).
 * A malformed non-string value returns `""` instead of throwing on
 * `.replace`, so one bad diagnostic can't abort parsing the whole batch.
 */
export const redactSensitiveText = (text: unknown): string => {
  if (typeof text !== "string" || text === "") return "";
  let redacted = text;
  for (const rule of KNOWN_SECRET_RULES) {
    redacted = redacted.replace(rule.pattern, rule.replacement);
  }
  return redactHighEntropyTokens(redacted);
};
