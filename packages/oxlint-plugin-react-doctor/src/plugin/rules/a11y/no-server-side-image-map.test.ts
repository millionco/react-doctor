import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noServerSideImageMap } from "./no-server-side-image-map.js";

describe("no-server-side-image-map", () => {
  it("reports enabled isMap images", () => {
    const result = runRule(
      noServerSideImageMap,
      `const Map = () => <img src="map.png" alt="Campus" isMap />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts disabled and dynamic isMap values", () => {
    const result = runRule(
      noServerSideImageMap,
      `const Map = ({ enabled }) => <><img isMap={false} /><img isMap={enabled} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
