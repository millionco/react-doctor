import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveLintBatchOrdering } from "../src/utils/resolve-lint-batch-ordering.js";

const ORDERING_ENV_VAR = "REACT_DOCTOR_LINT_BATCH_ORDERING";

describe("resolveLintBatchOrdering", () => {
  let savedOrdering: string | undefined;

  beforeEach(() => {
    savedOrdering = process.env[ORDERING_ENV_VAR];
    delete process.env[ORDERING_ENV_VAR];
  });

  afterEach(() => {
    if (savedOrdering === undefined) {
      delete process.env[ORDERING_ENV_VAR];
    } else {
      process.env[ORDERING_ENV_VAR] = savedOrdering;
    }
  });

  it("defaults to 'cost' when the env var is unset", () => {
    expect(resolveLintBatchOrdering()).toBe("cost");
  });

  it("returns 'cost' for an exact lowercase match", () => {
    process.env[ORDERING_ENV_VAR] = "cost";
    expect(resolveLintBatchOrdering()).toBe("cost");
  });

  it("returns 'arrival' for an uppercase value (case-insensitive)", () => {
    process.env[ORDERING_ENV_VAR] = "ARRIVAL";
    expect(resolveLintBatchOrdering()).toBe("arrival");
  });

  it("returns 'arrival' for a value with surrounding whitespace and mixed case", () => {
    process.env[ORDERING_ENV_VAR] = "  Arrival  ";
    expect(resolveLintBatchOrdering()).toBe("arrival");
  });

  it("returns 'arrival' for the explicit 'arrival' value", () => {
    process.env[ORDERING_ENV_VAR] = "arrival";
    expect(resolveLintBatchOrdering()).toBe("arrival");
  });

  it("returns 'cost' for an unrecognized value", () => {
    process.env[ORDERING_ENV_VAR] = "nonsense";
    expect(resolveLintBatchOrdering()).toBe("cost");
  });

  it("returns 'cost' for an empty string", () => {
    process.env[ORDERING_ENV_VAR] = "";
    expect(resolveLintBatchOrdering()).toBe("cost");
  });
});
