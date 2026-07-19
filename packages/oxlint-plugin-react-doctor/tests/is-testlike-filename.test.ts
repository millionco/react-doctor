import { describe, expect, it } from "vite-plus/test";
import { isTestlikeFilename } from "../src/plugin/utils/is-testlike-filename.js";

describe("isTestlikeFilename", () => {
  it("recognizes .dumi docs paths even when they wrap source-root segments", () => {
    expect(isTestlikeFilename("/repo/.dumi/pages/index/components/ThemePreview/index.tsx")).toBe(
      true,
    );
    expect(isTestlikeFilename("/repo/.dumi/theme/builtins/Previewer/Actions.tsx")).toBe(true);
  });

  it("recognizes .storybook paths above a source-root segment", () => {
    expect(isTestlikeFilename("/repo/.storybook/components/Decorator.tsx")).toBe(true);
  });

  it("recognizes test directories and suffixes below a source root", () => {
    expect(isTestlikeFilename("/repo/components/space/__tests__/index.test.tsx")).toBe(true);
    expect(isTestlikeFilename("/repo/components/config-provider/demo/direction.tsx")).toBe(true);
  });

  it("treats regular source files as production", () => {
    expect(isTestlikeFilename("/repo/src/components/Button.tsx")).toBe(false);
  });

  it("keeps fixture-project source roots as production despite outer test wrappers", () => {
    expect(isTestlikeFilename("monorepo/tests/fixtures/proj/src/app/page.tsx")).toBe(false);
  });
});
