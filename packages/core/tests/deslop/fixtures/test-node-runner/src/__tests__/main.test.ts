import { describe, it } from "node:test";
import { main } from "../index";

describe("main", () => {
  it("should return hello", () => {
    main();
  });
});
