import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

describe("no-reset-all-state-on-prop-change — regressions", () => {
  // excalidraw ToolPopover: the setter only runs inside an event-subscription
  // callback registered by the effect, so state resets when the emitter
  // fires — not when the `app` prop changes.
  it("stays silent when the setter only runs inside a subscription callback", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const ToolPopover = ({ app }) => {
        const [isPopupOpen, setIsPopupOpen] = useState(false);
        useEffect(() => {
          const unsubscribe = app.onPointerDownEmitter.on(() => {
            setIsPopupOpen(false);
          });
          return () => unsubscribe?.();
        }, [app]);
        return <div>{String(isPopupOpen)}</div>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a synchronous all-state reset keyed on a prop", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Profile = ({ userId }) => {
        const [comment, setComment] = useState("");
        useEffect(() => {
          setComment("");
        }, [userId]);
        return <textarea value={comment} onChange={(e) => setComment(e.target.value)} />;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("clears all state");
  });
});
