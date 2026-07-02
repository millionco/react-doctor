import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartNoSecretsInLoader } from "./tanstack-start-no-secrets-in-loader.js";

const ROUTE = { filename: "src/routes/index.tsx" };

describe("tanstack-start/tanstack-start-no-secrets-in-loader — regressions", () => {
  it("stays silent when the secret is read inside an inline createServerFn handler", () => {
    const { diagnostics } = runRule(
      tanstackStartNoSecretsInLoader,
      `createFileRoute('/x')({ loader: async () => { const getSecret = createServerFn().handler(() => process.env.STRIPE_SECRET_KEY); return getSecret(); } });`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a secret read directly in the loader body", () => {
    const { diagnostics } = runRule(
      tanstackStartNoSecretsInLoader,
      `createFileRoute('/x')({ loader: async () => { return process.env.STRIPE_SECRET_KEY; } });`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
