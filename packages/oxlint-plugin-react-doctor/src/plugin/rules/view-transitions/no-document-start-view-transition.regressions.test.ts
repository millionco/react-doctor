import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDocumentStartViewTransition } from "./no-document-start-view-transition.js";

describe("view-transitions/no-document-start-view-transition regressions", () => {
  it("stays silent on the mined ant-design shape: feature-detected global call, no React ViewTransition import", () => {
    const result = runRule(
      noDocumentStartViewTransition,
      `
      import * as React from 'react';
      const useThemeAnimation = () => {
        const toggleAnimationTheme = (event: React.MouseEvent<HTMLElement>, isDark: boolean) => {
          if (!(event && typeof document.startViewTransition === 'function')) {
            return;
          }
          document
            .startViewTransition(async () => {
              const root = document.documentElement;
              root.classList.remove(isDark ? 'dark' : 'light');
              root.classList.add(isDark ? 'light' : 'dark');
            })
            .ready.then(() => {});
        };
        return toggleAnimationTheme;
      };
      export default useThemeAnimation;
      `,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a bare global call in a file without a React ViewTransition import", () => {
    const result = runRule(
      noDocumentStartViewTransition,
      `document.startViewTransition(() => {});`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a direct call when the file imports ViewTransition from react", () => {
    const result = runRule(
      noDocumentStartViewTransition,
      `import { ViewTransition } from 'react';
const Gallery = ({ items, select }) => {
  const onSelect = (id) => document.startViewTransition(() => select(id));
  return <ViewTransition>{items.map((item) => <img key={item.id} onClick={() => onSelect(item.id)} />)}</ViewTransition>;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a direct call when the file imports unstable_ViewTransition from react", () => {
    const result = runRule(
      noDocumentStartViewTransition,
      `import { unstable_ViewTransition as ViewTransition } from 'react';
const swap = () => document.startViewTransition(() => {});`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("exempts a locally-bound `document` (parameter shadows the global) even with the react import", () => {
    const result = runRule(
      noDocumentStartViewTransition,
      `import { ViewTransition } from 'react';
function f(document){ document.startViewTransition(() => {}); }`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
