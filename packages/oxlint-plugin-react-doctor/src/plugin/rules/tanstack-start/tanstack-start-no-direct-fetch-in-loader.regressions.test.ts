import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartNoDirectFetchInLoader } from "./tanstack-start-no-direct-fetch-in-loader.js";

describe("tanstack-start/tanstack-start-no-direct-fetch-in-loader — regressions", () => {
  it("flags a raw fetch() inside a route loader", () => {
    const result = runRule(
      tanstackStartNoDirectFetchInLoader,
      `export const Route = createFileRoute("/todos")({
        loader: async () => {
          const response = await fetch("/api/todos");
          return response.json();
        },
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Direct fetch()");
  });

  it("stays silent when the loader calls a server function", () => {
    const result = runRule(
      tanstackStartNoDirectFetchInLoader,
      `export const Route = createFileRoute("/todos")({
        loader: async () => await getTodos(),
      });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
