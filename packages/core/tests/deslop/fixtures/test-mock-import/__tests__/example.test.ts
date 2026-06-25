import { vi, describe, it, expect } from "vitest";
vi.mock("../src/mocked-util");
import { helper } from "../src/index";

describe("test", () => {
  it("works", () => {
    expect(helper()).toBe("help");
  });
});
