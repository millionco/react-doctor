import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGreedyFirstOpenLastCloseJsonExtract } from "./no-greedy-first-open-last-close-json-extract.js";

describe("no-greedy-first-open-last-close-json-extract", () => {
  it("flags a first-open/last-close slice fed to JSON.parse on a response", () => {
    const result = runRule(
      noGreedyFirstOpenLastCloseJsonExtract,
      `function parse(response) {
        const firstOpen = response.indexOf('{');
        const lastClose = response.lastIndexOf('}');
        return JSON.parse(response.substring(firstOpen, lastClose + 1));
      }`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a greedy array slice on raw model output", () => {
    const result = runRule(
      noGreedyFirstOpenLastCloseJsonExtract,
      `function extract(response) {
        const start = response.indexOf('[');
        const end = response.lastIndexOf(']');
        const parsed = JSON.parse(response.slice(start, end + 1));
        return parsed;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a fallback extraction after a prior JSON.parse threw", () => {
    const result = runRule(
      noGreedyFirstOpenLastCloseJsonExtract,
      `function loose(completion) {
        try {
          return JSON.parse(completion);
        } catch {
          const cleaned = completion.substring(completion.indexOf('{'), completion.lastIndexOf('}') + 1);
          return JSON.parse(cleaned);
        }
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a slice when the function does a code-fence match", () => {
    const result = runRule(
      noGreedyFirstOpenLastCloseJsonExtract,
      `function fromMarkdown(str) {
        const fenced = str.match(/\`\`\`(?:json)?/);
        const body = str.substring(str.indexOf('{'), str.lastIndexOf('}') + 1);
        return JSON.parse(body);
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a controlled single-object payload with no free-form signal", () => {
    const result = runRule(
      noGreedyFirstOpenLastCloseJsonExtract,
      `function read(configBlob) {
        const body = configBlob.substring(configBlob.indexOf('{'), configBlob.lastIndexOf('}') + 1);
        return JSON.parse(body);
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a slice that never becomes JSON", () => {
    const result = runRule(
      noGreedyFirstOpenLastCloseJsonExtract,
      `function label(response, element) {
        const text = response.substring(response.indexOf('{'), response.lastIndexOf('}') + 1);
        element.textContent = text;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a slice with mismatched brackets", () => {
    const result = runRule(
      noGreedyFirstOpenLastCloseJsonExtract,
      `function odd(response) {
        return JSON.parse(response.substring(response.indexOf('{'), response.lastIndexOf(']') + 1));
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a slice not built from indexOf/lastIndexOf", () => {
    const result = runRule(
      noGreedyFirstOpenLastCloseJsonExtract,
      `function fixed(response) {
        return JSON.parse(response.substring(0, response.length));
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
