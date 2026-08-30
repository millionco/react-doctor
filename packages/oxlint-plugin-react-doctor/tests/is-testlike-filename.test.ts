import { describe, expect, it } from "vite-plus/test";
import {
  isTestlikeFilename,
  isTestlikeFilenameIgnoringPathSegments,
} from "../src/plugin/utils/is-testlike-filename.js";

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
  });

  it("does not suppress source files solely because their basename marks a demo", () => {
    expect(isTestlikeFilename("/repo/src/hooks/useHover/useHover.demo.tsx")).toBe(false);
    expect(isTestlikeFilename("/repo/src/components/Button/Button.demos.tsx")).toBe(false);
  });

  it("recognizes test-utility directories below a source root", () => {
    expect(isTestlikeFilename("/repo/src/connector/testUtils/mockGremlinFetch.ts")).toBe(true);
    expect(isTestlikeFilename("/repo/src/shared/test-utils/render.tsx")).toBe(true);
  });

  it("treats regular source files as production", () => {
    expect(isTestlikeFilename("/repo/src/components/Button.tsx")).toBe(false);
  });

  it("keeps fixture-project source roots as production despite outer test wrappers", () => {
    expect(isTestlikeFilename("monorepo/tests/fixtures/proj/src/app/page.tsx")).toBe(false);
  });

  describe("ambiguous path segments (tools/demo/examples/migrations)", () => {
    it("treats /tools/ at repo root as non-production", () => {
      expect(isTestlikeFilename("/repo/tools/build-script.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/tools/cli/command.ts")).toBe(true);
    });

    it("treats /tools/ inside source roots as production", () => {
      expect(isTestlikeFilename("/repo/src/components/tools/widget.tsx")).toBe(false);
      expect(isTestlikeFilename("/repo/app/admin/tools/dashboard.tsx")).toBe(false);
      expect(isTestlikeFilename("/repo/src/pages/tools/settings.tsx")).toBe(false);
    });

    it("treats /demo/ as non-production everywhere (component library demos)", () => {
      expect(isTestlikeFilename("/repo/demo/app.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/demos/interactive.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/src/components/demo/showcase.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/app/pages/demo/interactive.tsx")).toBe(true);
    });

    it("treats /examples/ as non-production everywhere (documentation examples)", () => {
      expect(isTestlikeFilename("/repo/examples/basic.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/example/usage.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/src/pages/examples/showcase.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/app/components/example/card.tsx")).toBe(true);
    });

    it("treats /migrations/ at repo root as non-production", () => {
      expect(isTestlikeFilename("/repo/migrations/001_init.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/migration/setup.ts")).toBe(true);
    });

    it("treats /migrations/ inside source roots as production", () => {
      expect(isTestlikeFilename("/repo/src/admin/migrations/history.tsx")).toBe(false);
      expect(isTestlikeFilename("/repo/app/features/migration/status.tsx")).toBe(false);
    });

    it("treats /scripts/ at repo root as non-production", () => {
      expect(isTestlikeFilename("/repo/scripts/deploy.ts")).toBe(true);
    });

    it("treats /scripts/ inside source roots as production", () => {
      expect(isTestlikeFilename("/repo/src/api/scripts/runner.ts")).toBe(false);
    });

    it("treats other ambiguous segments correctly", () => {
      expect(isTestlikeFilename("/repo/cli/index.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/src/components/cli/terminal.tsx")).toBe(false);

      expect(isTestlikeFilename("/repo/bin/start.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/src/features/bin/viewer.tsx")).toBe(false);

      expect(isTestlikeFilename("/repo/generators/scaffold.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/src/tools/generator/wizard.tsx")).toBe(false);

      expect(isTestlikeFilename("/repo/codemods/transform.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/src/editor/codemod/apply.tsx")).toBe(false);

      expect(isTestlikeFilename("/repo/devtools/panel.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/src/components/devtools/inspector.tsx")).toBe(false);
    });
  });

  describe("unambiguous segments remain consistently non-production", () => {
    it("treats /test/ directories as non-production everywhere", () => {
      expect(isTestlikeFilename("/repo/test/unit.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/src/test/helper.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/app/test/setup.ts")).toBe(true);
    });

    it("treats /fixtures/ as non-production everywhere", () => {
      expect(isTestlikeFilename("/repo/fixtures/data.json")).toBe(true);
      expect(isTestlikeFilename("/repo/src/fixtures/mock.ts")).toBe(true);
    });

    it("treats /stories/ as non-production everywhere", () => {
      expect(isTestlikeFilename("/repo/stories/Button.stories.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/src/stories/Card.stories.tsx")).toBe(true);
    });

    it("treats /playground/ as non-production everywhere", () => {
      expect(isTestlikeFilename("/repo/playground/test.tsx")).toBe(true);
      expect(isTestlikeFilename("/repo/src/playground/sandbox.tsx")).toBe(true);
    });

    it("treats /benchmarks/ as non-production everywhere", () => {
      expect(isTestlikeFilename("/repo/benchmarks/perf.ts")).toBe(true);
      expect(isTestlikeFilename("/repo/src/benchmarks/render.ts")).toBe(true);
    });
  });
});

describe("isTestlikeFilenameIgnoringPathSegments", () => {
  it("can ignore one ambiguous directory marker", () => {
    expect(
      isTestlikeFilenameIgnoringPathSegments("app/ai_sdk/tools/action.ts", new Set(["/tools/"])),
    ).toBe(false);
  });

  it("still honors suffixes and other non-production directories", () => {
    const ignoredPathSegments = new Set(["/tools/"]);
    expect(
      isTestlikeFilenameIgnoringPathSegments(
        "app/ai_sdk/tools/action.test.ts",
        ignoredPathSegments,
      ),
    ).toBe(true);
    expect(
      isTestlikeFilenameIgnoringPathSegments("app/__tests__/tools/action.ts", ignoredPathSegments),
    ).toBe(true);
  });
});
