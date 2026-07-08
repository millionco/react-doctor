import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNoninteractiveTabindex } from "./no-noninteractive-tabindex.js";

const disallowExpressionValuesSettings = {
  "react-doctor": {
    noNoninteractiveTabindex: { allowExpressionValues: false },
  },
};

describe("a11y/no-noninteractive-tabindex regressions", () => {
  describe("refs do not exempt (refs imply measurement/observers, not focus management)", () => {
    it("fires on a div with tabIndex and a measurement ref", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={0} ref={measureRef}>static text</div>`)
          .diagnostics,
      ).toHaveLength(1);
    });

    it("fires on an article with tabIndex and an IntersectionObserver ref", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<article tabIndex="0" ref={observerRef} />`).diagnostics,
      ).toHaveLength(1);
    });

    it("fires on a bare div with tabIndex", () => {
      expect(runRule(noNoninteractiveTabindex, `<div tabIndex={0} />`).diagnostics).toHaveLength(1);
    });
  });

  describe("keyboard handlers exempt (roving focus / modal keyboard wiring)", () => {
    it("stays silent on a div with tabIndex and onKeyDown", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={0} onKeyDown={handleKeyDown} />`)
          .diagnostics,
      ).toEqual([]);
    });

    it("stays silent on a div with tabIndex, onKeyDown, and a ref", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<div tabIndex={0} ref={containerRef} onKeyDown={handleKeyDown} />`,
        ).diagnostics,
      ).toEqual([]);
    });
  });

  describe("allowExpressionValues: false honors the keyboard guard", () => {
    it("stays silent on an expression tabIndex with onKeyDown", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={someVar} onKeyDown={handleKey} />`, {
          settings: disallowExpressionValuesSettings,
        }).diagnostics,
      ).toEqual([]);
    });

    it("still fires on an expression tabIndex without keyboard wiring", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={someVar} />`, {
          settings: disallowExpressionValuesSettings,
        }).diagnostics,
      ).toHaveLength(1);
    });

    it("still fires on an expression tabIndex with only a ref", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={someVar} ref={containerRef} />`, {
          settings: disallowExpressionValuesSettings,
        }).diagnostics,
      ).toHaveLength(1);
    });
  });

  describe("roving tabindex", () => {
    it("does not flag a conditional roving tabIndex with a negative branch", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={isActive ? 0 : -1} />`).diagnostics,
      ).toEqual([]);
    });

    it("still flags a conditional tabIndex whose branches are both non-negative", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={isActive ? 0 : 1} />`).diagnostics,
      ).toHaveLength(1);
    });
  });

  describe("conditional focusability with a nullish branch", () => {
    it("does not flag `tabIndex={isScrollable ? 0 : undefined}`", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={maxLines != null ? 0 : undefined} />`)
          .diagnostics,
      ).toEqual([]);
    });

    it("does not flag `tabIndex={ready ? 0 : null}`", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<span tabIndex={breakdownReady ? 0 : null} />`)
          .diagnostics,
      ).toEqual([]);
    });
  });

  describe("focus handlers exempt (tooltip triggers / focus-trap sentinels)", () => {
    it("stays silent on a span whose onFocus shows a tooltip", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<span tabIndex={0} onFocus={() => setShow(true)} onBlur={() => setShow(false)}>truncated text</span>`,
        ).diagnostics,
      ).toEqual([]);
    });

    it("stays silent on a tab-loop sentinel div with onFocus", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={0} onFocus={handleFocusStart} />`)
          .diagnostics,
      ).toEqual([]);
    });
  });

  describe("spread props can supply interactivity", () => {
    it("stays silent on a div spreading floating-ui reference props", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={0} {...getReferenceProps()} />`)
          .diagnostics,
      ).toEqual([]);
    });

    it("stays silent on a span spreading downshift toggle-button props", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<span tabIndex={0} {...getToggleButtonProps()} />`)
          .diagnostics,
      ).toEqual([]);
    });
  });

  describe("scrollable-region patterns", () => {
    it("stays silent on a focusable <pre> code block", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<pre tabIndex={0}>{code}</pre>`).diagnostics,
      ).toEqual([]);
    });

    it("stays silent on a named role=region scroll container", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<div role="region" aria-labelledby="drawer-heading" tabIndex={0}>{content}</div>`,
        ).diagnostics,
      ).toEqual([]);
    });
  });

  describe("accessible name signals an information stop", () => {
    it("stays silent on an aria-labelled tooltip trigger span", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<span aria-label={privacyNote} data-tooltip={privacyNote} tabIndex={0}><Info /></span>`,
        ).diagnostics,
      ).toEqual([]);
    });

    it("still flags an unlabeled static div with tabIndex", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={0}>static text</div>`).diagnostics,
      ).toHaveLength(1);
    });
  });

  describe("tooltip/popover triggers", () => {
    it("stays silent on a focusable span that is a Tooltip's direct child", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `
            const SelectorErrorTooltip = (props) => (
              <Tooltip {...props}>
                <span tabIndex={0} className={styles.SelectorErrorTooltip}>
                  <Text visuallyHidden>Error</Text>
                  <Icon symbol={ErrorIcon} />
                </span>
              </Tooltip>
            );
          `,
        ).diagnostics,
      ).toEqual([]);
    });

    it("stays silent on a focusable div assigned to a `trigger` variable", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `
            const trigger = (
              <div className={rightIconClass} tabIndex={0}>
                <Icon name="info" />
              </div>
            );
          `,
        ).diagnostics,
      ).toEqual([]);
    });

    it("stays silent on a focusable div wrapping a Popover", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `
            const Demo = () => (
              <div tabIndex={0}>
                <Popover size="medium" header="Memory error" content={content}>
                  sj-45ab8k
                </Popover>
              </div>
            );
          `,
        ).diagnostics,
      ).toEqual([]);
    });
  });

  describe("focusable scroll containers", () => {
    it("stays silent on an overflow-auto preview container", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<div tabIndex={0} className="z-10 flex max-h-full overflow-auto outline-none">{children}</div>`,
        ).diagnostics,
      ).toEqual([]);
    });

    it("stays silent on an overflow-y-scroll container", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<div tabIndex={0} className="overflow-y-scroll h-64">{rows}</div>`,
        ).diagnostics,
      ).toEqual([]);
    });

    it("still flags a non-scrollable styled div", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<div tabIndex={0} className="flex flex-col gap-2">static text</div>`,
        ).diagnostics,
      ).toHaveLength(1);
    });
  });

  describe("library-managed interactive surfaces", () => {
    it("stays silent on a map container with a ref and mouse handlers", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `
            const Viewer = () => (
              <div
                className="map-viewer-component"
                ref={mapViewerRef}
                tabIndex={0}
                onContextMenu={onContextMenu}
                onMouseDown={onMouseDown}
                onMouseUp={onMouseUp}
              >
                <MapLoadIndicator />
              </div>
            );
          `,
        ).diagnostics,
      ).toEqual([]);
    });
  });

  describe("focus-trap sentinels", () => {
    it("stays silent on bare sentinel divs bracketing dialog content", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `
            const Dialog = () => (
              <div className={overlayClass}>
                <div tabIndex={0} />
                <div role="dialog" ref={containerRef}>{children}</div>
                <div tabIndex={0} />
              </div>
            );
          `,
        ).diagnostics,
      ).toEqual([]);
    });
  });

  describe("focusable dialog containers", () => {
    it("stays silent on a role=dialog calendar popup", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<div tabIndex={0} className={styles.calendar} role="dialog"><InternalCalendar /></div>`,
        ).diagnostics,
      ).toEqual([]);
    });
  });

  describe("testlike files are skipped", () => {
    it("stays silent in a unit test file", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={0} />`, {
          filename: "/repo/src/editor/Editor.undoShortcuts.test.tsx",
        }).diagnostics,
      ).toEqual([]);
    });

    it("stays silent in a Storybook story", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<span tabIndex={0}>badge</span>`, {
          filename: "/repo/src/Badge/Badge.stories.tsx",
        }).diagnostics,
      ).toEqual([]);
    });
  });
});
