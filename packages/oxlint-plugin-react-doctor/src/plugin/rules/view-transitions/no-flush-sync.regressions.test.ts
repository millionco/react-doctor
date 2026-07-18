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

  it("stays silent when selection restoration immediately follows flushSync", () => {
    expectPass(
      `import { flushSync } from "react-dom";
const acceptRemoteEvents = (selectionSync, selection, operations) => {
  flushSync(() => {
    setText(readRemoteText());
  });
  if (selection && operations.length > 0) {
    selectionSync.restoreSelection(mapSelection(selection, operations));
  }
};`,
    );
  });

  it("stays silent on a nested selection restoration member", () => {
    expectPass(
      `import { flushSync } from "react-dom";
const integrateRemoteEvents = (context, selection) => {
  flushSync(() => {
    context.setText(readRemoteText());
  });
  if (selection) {
    context.selectionSync.restoreSelection(selection);
  }
};`,
    );
  });

  it("stays silent when an adjacent local helper mutates the DOM", () => {
    expectPass(
      `import { flushSync } from "react-dom";
const restoreSelection = (textarea, selection) => {
  textarea.setSelectionRange(selection.start, selection.end);
};
const updateText = (textarea, selection) => {
  flushSync(() => setText(readRemoteText()));
  restoreSelection(textarea, selection);
};`,
    );
  });

  it("still flags an adjacent unknown helper", () => {
    expectFail(
      `import { flushSync } from "react-dom";
const updateText = () => {
  flushSync(() => setText(readRemoteText()));
  notifyTextUpdated();
};`,
    );
  });

  it("still flags a non-adjacent imperative mutation", () => {
    expectFail(
      `import { flushSync } from "react-dom";
const updateText = (textarea, selection) => {
  flushSync(() => setText(readRemoteText()));
  notifyTextUpdated();
  textarea.setSelectionRange(selection.start, selection.end);
};`,
    );
  });

  it("still flags an imperative mutation outside a bare control-flow branch", () => {
    expectFail(
      `import { flushSync } from "react-dom";
const updateText = (textarea, shouldUpdate) => {
  if (shouldUpdate) flushSync(() => setText(readRemoteText()));
  textarea.focus();
};`,
    );
  });

  it("still flags an adjacent generic select method", () => {
    expectFail(
      `import { flushSync } from "react-dom";
const updateSelection = (store) => {
  flushSync(() => setText(readRemoteText()));
  store.select("activeDocument");
};`,
    );
  });

  it("still flags a deferred imperative helper call", () => {
    expectFail(
      `import { flushSync } from "react-dom";
const restoreSelection = (textarea, selection) => {
  textarea.setSelectionRange(selection.start, selection.end);
};
const updateText = (textarea, selection) => {
  flushSync(() => setText(readRemoteText()));
  const restoreLater = () => restoreSelection(textarea, selection);
  queueMicrotask(restoreLater);
};`,
    );
  });

  it("still flags an adjacent imperative function declaration", () => {
    expectFail(
      `import { flushSync } from "react-dom";
const updateText = (textarea) => {
  flushSync(() => setText(readRemoteText()));
  function restoreLater() {
    textarea.focus();
  }
  queueMicrotask(restoreLater);
};`,
    );
  });

  it("stays silent on a top-level imperative handoff", () => {
    expectPass(
      `import { flushSync } from "react-dom";
flushSync(() => setText(readRemoteText()));
textarea.focus();`,
    );
  });

  it("stays silent on an imperative handoff in a switch case", () => {
    expectPass(
      `import { flushSync } from "react-dom";
const updateText = (textarea, mode) => {
  switch (mode) {
    case "edit":
      flushSync(() => setText(readRemoteText()));
      textarea.focus();
      break;
  }
};`,
    );
  });

  it("stays silent on an imperative handoff in a static block", () => {
    expectPass(
      `import { flushSync } from "react-dom";
class Editor {
  static {
    flushSync(() => setText(readRemoteText()));
    textarea.focus();
  }
}`,
    );
  });
});
