import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGiantComponent } from "./no-giant-component.js";

const buildBodyExceedingThreshold = (): string =>
  Array.from(
    { length: 301 },
    (_, statementIndex) => `  const value${statementIndex} = ${statementIndex};`,
  ).join("\n");

const expectDiagnosticCount = (
  code: string,
  expectedDiagnosticCount: number,
  filename = "fixture.tsx",
): void => {
  const result = runRule(noGiantComponent, code, { filename });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
};

describe("architecture/no-giant-component — fail cases", () => {
  it("flags an oversized PascalCase function that returns JSX", () => {
    expectDiagnosticCount(
      `function GiantComponent() {
${buildBodyExceedingThreshold()}
  return <main />;
}`,
      1,
    );
  });

  it("flags an oversized PascalCase arrow component that returns JSX", () => {
    expectDiagnosticCount(
      `const GiantComponent = () => {
${buildBodyExceedingThreshold()}
  return <main />;
};`,
      1,
    );
  });

  it("flags an oversized TypeScript component using React.createElement", () => {
    expectDiagnosticCount(
      `import React from "react";

function GiantComponent() {
${buildBodyExceedingThreshold()}
  return React.createElement("main", null);
}`,
      1,
      "fixture.ts",
    );
  });

  it("flags an oversized memo-wrapped named function component (freecut TimelineTrack shape)", () => {
    expectDiagnosticCount(
      `import { memo } from "react";

export const TimelineTrack = memo(function TimelineTrack({ track }) {
${buildBodyExceedingThreshold()}
  return <main />;
});`,
      1,
    );
  });

  it("flags an oversized React.memo arrow component (obby UserSettings shape)", () => {
    expectDiagnosticCount(
      `import React from "react";

export const UserSettings: React.FC = React.memo(() => {
${buildBodyExceedingThreshold()}
  return <main />;
});`,
      1,
    );
  });

  it("flags an oversized memo(forwardRef(...)) component", () => {
    expectDiagnosticCount(
      `import { memo, forwardRef } from "react";

export const Input = memo(forwardRef((props, ref) => {
${buildBodyExceedingThreshold()}
  return <main />;
}));`,
      1,
    );
  });

  it("flags an oversized TypeScript component using aliased createElement from react", () => {
    expectDiagnosticCount(
      `import { createElement as h } from "react";

const GiantComponent = () => {
${buildBodyExceedingThreshold()}
  return h("main", null);
};`,
      1,
      "fixture.ts",
    );
  });
});

describe("architecture/no-giant-component — pass cases (no diagnostics)", () => {
  it("does not flag an oversized PascalCase service function without React output", () => {
    expectDiagnosticCount(
      `function ExampleService() {
${buildBodyExceedingThreshold()}
  return fetch("/api/example");
}`,
      0,
      "example.service.ts",
    );
  });

  it("does not flag an oversized async PascalCase data helper", () => {
    expectDiagnosticCount(
      `const ExampleService = async () => {
${buildBodyExceedingThreshold()}
  return fetch("/api/example");
};`,
      0,
      "example.service.ts",
    );
  });

  it("does not flag an exported PascalCase object literal service", () => {
    const methods = Array.from(
      { length: 80 },
      (_, methodIndex) => `  getValue${methodIndex}: async () => fetch("/api/${methodIndex}"),`,
    ).join("\n");
    expectDiagnosticCount(
      `export const ExampleService = {
${methods}
};`,
      0,
      "example.service.ts",
    );
  });

  it("does not treat JSX inside a nested function as outer component evidence", () => {
    expectDiagnosticCount(
      `function ExampleService() {
  const Inner = () => <main />;
${buildBodyExceedingThreshold()}
  return fetch("/api/example");
}`,
      0,
    );
  });

  it("does not flag createElement imported from a non-React module", () => {
    expectDiagnosticCount(
      `import { createElement } from "./dom";

function ExampleService() {
${buildBodyExceedingThreshold()}
  return createElement("main");
}`,
      0,
      "example.service.ts",
    );
  });

  it("does not flag a local createElement helper", () => {
    expectDiagnosticCount(
      `function createElement(tagName: string) {
  return document.createElement(tagName);
}

function ExampleService() {
${buildBodyExceedingThreshold()}
  return createElement("main");
}`,
      0,
      "example.service.ts",
    );
  });

  it("does not flag a shadowed createElement import", () => {
    expectDiagnosticCount(
      `import { createElement } from "react";

function ExampleService() {
  const createElement = document.createElement.bind(document);
${buildBodyExceedingThreshold()}
  return createElement("main");
}`,
      0,
      "example.service.ts",
    );
  });

  it("does not flag a shadowed React namespace import", () => {
    expectDiagnosticCount(
      `import * as React from "react";

function ExampleService(React: Document) {
${buildBodyExceedingThreshold()}
  return React.createElement("main");
}`,
      0,
      "example.service.ts",
    );
  });

  it("does not flag global React.createElement without an import", () => {
    expectDiagnosticCount(
      `function ExampleService() {
${buildBodyExceedingThreshold()}
  return React.createElement("main", null);
}`,
      0,
      "example.service.ts",
    );
  });

  it("does not flag memo wrapping an identifier (no inline function to measure)", () => {
    expectDiagnosticCount(
      `import { memo } from "react";

function Giant() {
  return <main />;
}

export const Wrapped = memo(Giant);`,
      0,
    );
  });

  it("does not flag an oversized non-HOC call wrapper", () => {
    expectDiagnosticCount(
      `import { styledFactory } from "./factory";

export const GiantWidget = styledFactory(() => {
${buildBodyExceedingThreshold()}
  return <main />;
});`,
      0,
    );
  });

  it("does not flag a small memo-wrapped component", () => {
    expectDiagnosticCount(
      `import { memo } from "react";

export const Small = memo(() => {
  return <main />;
});`,
      0,
    );
  });
});
