import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { findExportedValue } from "./find-exported-value.js";
import { isNodeOfType } from "./is-node-of-type.js";

describe("findExportedValue", () => {
  it("resolves a default export backed by an imported binding", () => {
    const parsed = parseFixture(`import dayjs from"dayjs";export default dayjs`);
    const exportedValue = findExportedValue(parsed.program, "default");
    expect(isNodeOfType(exportedValue, "Identifier") && exportedValue.name).toBe("dayjs");
  });

  it("does not resolve a type-only imported binding", () => {
    const parsed = parseFixture(`import type Dayjs from"dayjs";export default Dayjs`);
    expect(findExportedValue(parsed.program, "default")).toBeNull();
  });
});
