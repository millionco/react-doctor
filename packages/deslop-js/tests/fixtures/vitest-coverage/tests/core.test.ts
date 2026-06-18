import { add } from "../src/core";

describe("core", () => {
  it("adds numbers", () => {
    expect(add(1, 2)).toBe(3);
  });
});
