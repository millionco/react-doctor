import { describe, expect, it } from "vite-plus/test";
import { REDACTED_PLACEHOLDER, redactSensitiveText } from "@react-doctor/core";

describe("redactSensitiveText", () => {
  it("returns empty input unchanged", () => {
    expect(redactSensitiveText("")).toBe("");
  });

  it("returns empty string for non-string input (malformed oxlint JSON guard)", () => {
    expect(redactSensitiveText(12345)).toBe("");
    expect(redactSensitiveText(null)).toBe("");
    expect(redactSensitiveText(undefined)).toBe("");
    expect(redactSensitiveText({ help: "x" })).toBe("");
  });

  it("leaves ordinary diagnostic prose untouched", () => {
    const messages = [
      "useState initialized from prop",
      "useContext is superseded by `use()`",
      "forwardRef is no longer needed on React 19+",
      "Avoid calling setState inside useEffect (line 12:4)",
      "Move secrets to server-only code",
    ];
    for (const message of messages) {
      expect(redactSensitiveText(message)).toBe(message);
    }
  });

  it("keeps the provider prefix and redacts only the secret body", () => {
    expect(redactSensitiveText(`key=sk_live_${"4".repeat(24)}`)).toBe(
      `key=sk_live_${REDACTED_PLACEHOLDER}`,
    );
    expect(redactSensitiveText(`ghp_${"b".repeat(36)}`)).toBe(`ghp_${REDACTED_PLACEHOLDER}`);
  });

  it("masks the whole token when it is longer than the canonical length (no suffix leak)", () => {
    // npm tokens are canonically `npm_` + 36 chars; an over-long body must
    // be masked whole rather than leaving a trailing suffix visible.
    const longNpm = `npm_${"a1B2c3D4".repeat(6)}`;
    expect(longNpm.length).toBeGreaterThan("npm_".length + 36);
    expect(redactSensitiveText(longNpm)).toBe(`npm_${REDACTED_PLACEHOLDER}`);

    const longShopify = `shpat_${"a1b2c3d4".repeat(6)}`;
    expect(redactSensitiveText(longShopify)).toBe(`shpat_${REDACTED_PLACEHOLDER}`);
  });

  it("redacts an AWS access key id but keeps the AKIA prefix", () => {
    expect(redactSensitiveText("key AKIAIOSFODNN7EXAMPLE found")).toBe(
      `key AKIA${REDACTED_PLACEHOLDER} found`,
    );
  });

  it("redacts an AWS temporary (ASIA) access key id", () => {
    const key = `ASIA${"A1B2C3D4E5F6G7H8".slice(0, 16)}`;
    expect(redactSensitiveText(`creds ${key}`)).toBe(`creds ASIA${REDACTED_PLACEHOLDER}`);
  });

  it("redacts GitHub personal access tokens", () => {
    const token = `ghp_${"a".repeat(36)}`;
    expect(redactSensitiveText(`token: ${token}`)).toBe(`token: ghp_${REDACTED_PLACEHOLDER}`);
  });

  it("redacts a GitHub fine-grained PAT", () => {
    const token = `github_pat_${"A1b2c3d4e5".repeat(3)}`;
    expect(redactSensitiveText(token)).toBe(`github_pat_${REDACTED_PLACEHOLDER}`);
  });

  it("redacts a GitLab personal access token", () => {
    const token = `glpat-${"aB3dE6gH9j".repeat(2)}`;
    expect(redactSensitiveText(`token ${token}`)).toBe(`token glpat-${REDACTED_PLACEHOLDER}`);
  });

  it("redacts a Slack token but keeps the xox prefix", () => {
    const token = `xoxb-${"123456789012".repeat(2)}`;
    expect(redactSensitiveText(token)).toBe(`xoxb-${REDACTED_PLACEHOLDER}`);
  });

  it("redacts a Slack incoming-webhook path but keeps the host", () => {
    const url = `https://hooks.slack.com/services/T00000000/B11111111/${"a1B2c3D4e5".repeat(2)}`;
    const result = redactSensitiveText(url);
    expect(result).toContain("hooks.slack.com/services/");
    expect(result).toContain(REDACTED_PLACEHOLDER);
    expect(result).not.toContain("B11111111");
  });

  it("redacts an npm token but keeps the npm_ prefix", () => {
    const token = `npm_${"a1B2c3D4e5f6".repeat(3)}`.slice(0, 40);
    const result = redactSensitiveText(`//registry.npmjs.org/:_authToken=${token}`);
    expect(result).toBe(`//registry.npmjs.org/:_authToken=npm_${REDACTED_PLACEHOLDER}`);
  });

  it("redacts a SendGrid API key", () => {
    const key = `SG.${"a".repeat(22)}.${"b1C2d3E4".repeat(6).slice(0, 43)}`;
    expect(redactSensitiveText(key)).toBe(`SG.${REDACTED_PLACEHOLDER}`);
  });

  it("redacts a DigitalOcean token", () => {
    const token = `dop_v1_${"a1b2c3d4".repeat(8)}`;
    expect(redactSensitiveText(`do ${token}`)).toBe(`do dop_v1_${REDACTED_PLACEHOLDER}`);
  });

  it("redacts a Shopify access token", () => {
    const token = `shpat_${"a1b2c3d4".repeat(4)}`;
    expect(redactSensitiveText(token)).toBe(`shpat_${REDACTED_PLACEHOLDER}`);
  });

  it("redacts a Telegram bot token but spares plain digit:digit text", () => {
    const token = `123456789:AA${"x1Y2z3W4".repeat(4)}`;
    expect(redactSensitiveText(token)).toBe(`123456789:AA${REDACTED_PLACEHOLDER}`);
    expect(redactSensitiveText("retry after 12345:67890 ms")).toBe("retry after 12345:67890 ms");
  });

  it("redacts Stripe live keys but keeps the sk_live_ prefix", () => {
    expect(redactSensitiveText(`useState("sk_live_${"4".repeat(20)}")`)).toBe(
      `useState("sk_live_${REDACTED_PLACEHOLDER}")`,
    );
  });

  it("redacts OpenAI-style sk- keys but keeps the sk- prefix", () => {
    const key = `sk-${"A1b2".repeat(10)}`;
    expect(redactSensitiveText(`const apiKey = "${key}"`)).toBe(
      `const apiKey = "sk-${REDACTED_PLACEHOLDER}"`,
    );
  });

  it("redacts a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";
    expect(redactSensitiveText(`Authorization header ${jwt}`)).toBe(
      `Authorization header ${REDACTED_PLACEHOLDER}`,
    );
  });

  it("masks credentials inside a URL but keeps scheme and host", () => {
    expect(redactSensitiveText("postgres://admin:hunter2pass@db.internal:5432/app")).toBe(
      `postgres://${REDACTED_PLACEHOLDER}@db.internal:5432/app`,
    );
  });

  it("masks a URL password that itself contains colons", () => {
    expect(redactSensitiveText("mongodb://admin:p:a:ss@cluster.example.com:27017/db")).toBe(
      `mongodb://${REDACTED_PLACEHOLDER}@cluster.example.com:27017/db`,
    );
  });

  it("redacts a bearer token but keeps the scheme word", () => {
    const result = redactSensitiveText("Authorization: Bearer abcDEF123456ghijKLmnop");
    expect(result).toBe(`Authorization: Bearer ${REDACTED_PLACEHOLDER}`);
  });

  it("redacts email addresses (PII)", () => {
    expect(redactSensitiveText('useState("jane.doe@example.com")')).toBe(
      `useState("${REDACTED_PLACEHOLDER}")`,
    );
  });

  it("redacts a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    expect(redactSensitiveText(`key: ${pem}`)).toBe(`key: ${REDACTED_PLACEHOLDER}`);
  });

  it("redacts an unprefixed high-entropy token", () => {
    const token = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(redactSensitiveText(`token=${token}`)).toBe(`token=${REDACTED_PLACEHOLDER}`);
  });

  it("does not redact ordinary long identifiers without digits", () => {
    const identifier = "someVeryDescriptiveComponentDisplayName";
    expect(redactSensitiveText(identifier)).toBe(identifier);
  });

  it("does not redact short alphanumeric tokens", () => {
    expect(redactSensitiveText("status code 404 at offset 12ab")).toBe(
      "status code 404 at offset 12ab",
    );
  });

  it("does not redact a long but low-entropy identifier with a digit", () => {
    const lowEntropy = `${"a".repeat(31)}1`;
    expect(lowEntropy.length).toBeGreaterThanOrEqual(32);
    expect(redactSensitiveText(lowEntropy)).toBe(lowEntropy);
  });

  it("does not redact a git SHA-1 object id", () => {
    const sha1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
    expect(sha1).toHaveLength(40);
    expect(redactSensitiveText(`at commit ${sha1}`)).toBe(`at commit ${sha1}`);
  });

  it("does not redact a git SHA-256 object id", () => {
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(sha256).toHaveLength(64);
    expect(redactSensitiveText(`integrity ${sha256}`)).toBe(`integrity ${sha256}`);
  });

  it("does not redact a UUID (split into short tokens by dashes)", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(redactSensitiveText(`id ${uuid}`)).toBe(`id ${uuid}`);
  });

  it("redacts every distinct secret in a multi-secret message", () => {
    const message = `aws AKIAIOSFODNN7EXAMPLE gh ${`ghp_${"a".repeat(36)}`} mail dev@acme.io`;
    const result = redactSensitiveText(message);
    expect(result).toContain(`AKIA${REDACTED_PLACEHOLDER}`);
    expect(result).toContain(`ghp_${REDACTED_PLACEHOLDER}`);
    expect(result).not.toContain("IOSFODNN7EXAMPLE");
    expect(result).not.toContain("a".repeat(36));
    expect(result).not.toContain("dev@acme.io");
    expect(result.match(new RegExp(REDACTED_PLACEHOLDER, "g"))).toHaveLength(3);
  });

  it("completes quickly on a long adversarial input (no catastrophic backtracking)", () => {
    const adversarial = `-----BEGIN RSA PRIVATE KEY-----${"A".repeat(50_000)} ${"a1b2".repeat(20_000)}`;
    const start = performance.now();
    redactSensitiveText(adversarial);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it("is idempotent across known and generic detectors", () => {
    const messages = [
      `ghp_${"z".repeat(36)}`,
      `token=${"a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"}`,
      "postgres://admin:hunter2pass@db.internal:5432/app",
      "contact jane.doe@example.com",
    ];
    for (const message of messages) {
      const once = redactSensitiveText(message);
      expect(redactSensitiveText(once)).toBe(once);
    }
  });
});
