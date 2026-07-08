import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFlushSync } from "./no-flush-sync.js";

const expectFail = (code: string): void => {
  const result = runRule(noFlushSync, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noFlushSync, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("view-transitions/no-flush-sync — regressions", () => {
  it("still flags a plain flushSync state update", () => {
    expectFail(
      `import { flushSync } from "react-dom";
function C() {
  const onClick = () => {
    flushSync(() => {
      setCount((count) => count + 1);
    });
  };
  return <button onClick={onClick}>go</button>;
}`,
    );
  });

  it("still flags an unused flushSync import", () => {
    expectFail(`import { flushSync } from "react-dom";`);
  });

  // FP anchor (innovaccer PopperWrapper, ebay use-shaka-control): files
  // integrating a positioning/media library need the DOM committed before
  // the library's next line runs.
  it("stays silent when the file integrates a positioning library", () => {
    expectPass(
      `import { Manager, Reference, Popper } from "react-popper";
import { flushSync } from "react-dom";
function PopperWrapper() {
  const open = () => {
    flushSync(() => {
      setOpen(true);
    });
  };
  return <Popper />;
}`,
    );
  });

  it("stays silent when the file integrates shaka-player", () => {
    expectPass(
      `import { flushSync } from "react-dom";
import { ui } from "shaka-player/dist/shaka-player.ui";
const useShakaControl = () => {
  const attach = (parentEl) => {
    flushSync(() => {
      setContainer(parentEl);
    });
  };
  return attach;
};`,
    );
  });

  // FP anchor (marigold ToastProvider): flushSync inside
  // startViewTransition is the sanctioned pairing — it doesn't skip the
  // transition, it drives it.
  it("stays silent when flushSync runs inside startViewTransition", () => {
    expectPass(
      `import { flushSync } from "react-dom";
const wrapUpdate = (fn) => {
  if ("startViewTransition" in document) {
    document.startViewTransition(() => {
      flushSync(fn);
    });
  } else {
    fn();
  }
};`,
    );
  });

  // FP anchor (clerk use-animations-finished): the enclosing function
  // reads committed animation state via the Web Animations API.
  it("stays silent when the enclosing function measures committed DOM", () => {
    expectPass(
      `import { flushSync } from "react-dom";
const useAnimationsFinished = (ref) => {
  return (callback) => {
    const element = ref.current;
    Promise.all(element.getAnimations().map((animation) => animation.finished)).then(() => {
      flushSync(callback);
    });
  };
};`,
    );
  });

  // FP anchor (hightable ColumnHeader): the flushSync is followed by a
  // local helper that measures the freshly committed width.
  it("stays silent when a measuring helper runs after flushSync", () => {
    expectPass(
      `import { flushSync } from "react-dom";
function ColumnHeader({ releaseWidth, columnIndex }) {
  const ref = useRef(null);
  const tryToMeasureWidth = useCallback(() => {
    const element = ref.current;
    if (element) {
      setWidth(getOffsetWidth(element));
    }
  }, []);
  const autoResize = useCallback(() => {
    flushSync(() => {
      releaseWidth(columnIndex);
    });
    tryToMeasureWidth();
  }, [tryToMeasureWidth, releaseWidth, columnIndex]);
  return <th ref={ref} onDoubleClick={autoResize} />;
}`,
    );
  });
});
