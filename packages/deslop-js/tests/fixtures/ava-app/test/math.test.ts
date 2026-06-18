import test from "ava";
import { add } from "../src/math";

test("add works", (t) => {
  t.is(add(1, 2), 3);
});
