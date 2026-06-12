import { describe, expect, it } from "vite-plus/test";
import { classifyFileContext } from "@react-doctor/core";

describe("classifyFileContext", () => {
  it("classifies `.stories.*` / `.story.*` suffixes as story", () => {
    expect(classifyFileContext("src/components/Button.stories.tsx")).toBe("story");
    expect(classifyFileContext("src/components/Button.story.tsx")).toBe("story");
    expect(classifyFileContext("src/components/Button.stories.jsx")).toBe("story");
    expect(classifyFileContext("src/components/Button.story.mts")).toBe("story");
  });

  it("classifies story files inside test directories as story, not test", () => {
    expect(classifyFileContext("__tests__/Button.stories.tsx")).toBe("story");
    expect(classifyFileContext("tests/Button.story.tsx")).toBe("story");
  });

  it("classifies `.test.*` / `.spec.*` suffixes as test", () => {
    expect(classifyFileContext("src/utils/foo.test.ts")).toBe("test");
    expect(classifyFileContext("src/utils/foo.spec.tsx")).toBe("test");
    expect(classifyFileContext("src/utils/foo.test.mjs")).toBe("test");
  });

  it("classifies fixture suffixes and test directories as test", () => {
    expect(classifyFileContext("src/components/Button.fixture.tsx")).toBe("test");
    expect(classifyFileContext("src/utils/__tests__/foo.ts")).toBe("test");
    expect(classifyFileContext("cypress/e2e/login.cy.ts")).toBe("test");
    expect(classifyFileContext("e2e/checkout.ts")).toBe("test");
  });

  it("normalizes Windows-style backslashes", () => {
    expect(classifyFileContext("src\\components\\Button.stories.tsx")).toBe("story");
    expect(classifyFileContext("src\\utils\\__tests__\\foo.ts")).toBe("test");
  });

  it("classifies production source files as production", () => {
    expect(classifyFileContext("src/components/Button.tsx")).toBe("production");
    expect(classifyFileContext("packages/ui/src/index.ts")).toBe("production");
    expect(classifyFileContext("app/page.tsx")).toBe("production");
  });

  it("classifies fixture-project source files under `fixtures/` as production", () => {
    expect(classifyFileContext("tests/fixtures/sample/src/Button.tsx")).toBe("production");
    expect(classifyFileContext("tests/__fixtures__/repo/Component.tsx")).toBe("production");
  });

  it("classifies empty input as production", () => {
    expect(classifyFileContext("")).toBe("production");
  });
});
