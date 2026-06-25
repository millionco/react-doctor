import { vi, describe, it, expect } from "vitest";
import { formatDate } from "../src/utils/helper";

vi.mock("../src/utils/helper", () => ({
  formatDate: () => "inline mocked",
}));

describe("utils", () => {
  it("should use factory mock", () => {
    expect(formatDate()).toBe("inline mocked");
  });
});
