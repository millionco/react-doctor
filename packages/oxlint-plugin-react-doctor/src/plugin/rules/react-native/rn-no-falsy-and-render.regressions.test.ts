import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoFalsyAndRender } from "./rn-no-falsy-and-render.js";

describe("react-native/rn-no-falsy-and-render — regressions", () => {
  it("stays silent on a boolean useState named with a numeric-sounding word", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const C = () => {
  const [progress, setProgress] = useState(false);
  return <View>{progress && <Spinner />}</View>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a numeric .length gate", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const C = ({ items }) => <View>{items.length && <List />}</View>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
