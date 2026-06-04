import { describe, expect, it } from "vite-plus/test";
import { scrubSentryMetric } from "../src/cli/utils/scrub-sentry-metric.js";

interface TestMetric {
  name: string;
  value: number;
  attributes?: Record<string, unknown>;
}

const buildMetric = (): TestMetric => ({
  name: "scan.completed",
  value: 1,
  attributes: {
    "server.address": "janes-macbook.local",
    mode: "full",
    rule: "react-doctor/no-array-index-as-key",
    leakedPath: "/Users/jane/app/src",
    framework: "nextjs",
    count: 3,
  },
});

describe("scrubSentryMetric", () => {
  it("drops the server.address hostname attribute", () => {
    const scrubbed = scrubSentryMetric(buildMetric());
    expect(scrubbed).not.toBeNull();
    expect(scrubbed?.attributes?.["server.address"]).toBeUndefined();
  });

  it("scrubs home-directory paths from attribute values", () => {
    const scrubbed = scrubSentryMetric(buildMetric());
    expect(JSON.stringify(scrubbed)).not.toContain("/Users/jane");
    expect(scrubbed?.attributes?.leakedPath).toBe("~/app/src");
  });

  it("masks known secrets that leak into attribute values", () => {
    const metric = buildMetric();
    metric.attributes = {
      ...metric.attributes,
      token: "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    const scrubbed = scrubSentryMetric(metric);
    expect(scrubbed?.attributes?.token).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(String(scrubbed?.attributes?.token)).toContain("ghp_<redacted>");
  });

  it("keeps anonymous attributes intact", () => {
    const scrubbed = scrubSentryMetric(buildMetric());
    expect(scrubbed?.attributes?.mode).toBe("full");
    expect(scrubbed?.attributes?.framework).toBe("nextjs");
    expect(scrubbed?.attributes?.rule).toBe("react-doctor/no-array-index-as-key");
    expect(scrubbed?.attributes?.count).toBe(3);
  });

  it("returns null rather than send when scrubbing fails", () => {
    // A frozen attributes object makes the `delete` throw under strict mode, so
    // the metric is dropped rather than sent un-anonymized.
    const metric = { name: "x", value: 1, attributes: Object.freeze({ "server.address": "host" }) };
    expect(scrubSentryMetric(metric)).toBeNull();
  });

  it("is a no-op for a metric without attributes", () => {
    const metric: TestMetric = { name: "cli.invoked", value: 1 };
    expect(scrubSentryMetric(metric)).toBe(metric);
  });
});
