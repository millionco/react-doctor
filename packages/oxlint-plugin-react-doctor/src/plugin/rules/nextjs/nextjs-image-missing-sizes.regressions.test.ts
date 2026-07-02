import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsImageMissingSizes } from "./nextjs-image-missing-sizes.js";

describe("nextjs/nextjs-image-missing-sizes — regressions", () => {
  it("stays silent when sizes can be forwarded via spread", () => {
    const result = runRule(
      nextjsImageMissingSizes,
      `function Cover(rest) { return <Image fill {...rest} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags fill without sizes when attributes are explicit", () => {
    const result = runRule(
      nextjsImageMissingSizes,
      `const C = () => <Image fill src="/a.png" alt="a" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when fill is explicitly false", () => {
    const result = runRule(
      nextjsImageMissingSizes,
      `const C = () => <Image fill={false} src="/a.png" width={100} height={100} alt="" />;`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags fill={true} without sizes", () => {
    const result = runRule(
      nextjsImageMissingSizes,
      `const C = () => <Image fill={true} src="/a.png" alt="" />;`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
