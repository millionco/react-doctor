// rule: secret-in-fallback
// weakness: test-gating
// source: Daytona eval gitcoinco/grants-stack@572d3fb packages/builder/fixtures.ts

export const privateKey =
  process.env.TEST_PRIVATE_KEY ?? "test test test test test test test test test test test junk";
