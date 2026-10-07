import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsImageMissingSizes } from "./nextjs-image-missing-sizes.js";

describe("nextjs-image-missing-sizes unoptimized images", () => {
  it.each(["unoptimized", "unoptimized={true}", "unoptimized={true as boolean}"])(
    "accepts an image with %s",
    (attribute) => {
      const result = runRule(
        nextjsImageMissingSizes,
        `const Cover = () => <Image fill ${attribute} src="/cover.png" alt="Cover" />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each(["", "unoptimized={false}", "unoptimized={undefined}", "unoptimized={enabled}"])(
    "still reports a possibly optimized image with %s",
    (attribute) => {
      const result = runRule(
        nextjsImageMissingSizes,
        `const Cover = ({ enabled }) => <Image fill ${attribute} src="/cover.png" alt="Cover" />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
