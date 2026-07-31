import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseEffectEvent } from "./prefer-use-effect-event.js";

const runPreferUseEffectEvent = (code: string) => runRule(preferUseEffectEvent, code);

describe("prefer-use-effect-event — React Bench regressions", () => {
  it("reports a callback prop used by a bound capture listener in a function component", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      export function Modal({ isOpen, onClose, disableClose = false }) {
        useEffect(() => {
          if (!isOpen) return;
          const handleKeyDown = (event) => {
            if (event.key === "Escape" && !disableClose) {
              event.stopPropagation();
              onClose();
            }
          };
          document.addEventListener("keydown", handleKeyDown, true);
          return () => document.removeEventListener("keydown", handleKeyDown, true);
        }, [isOpen, disableClose, onClose]);
        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a changing useCallback used by a bound capture listener", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect } from "react";

      export function HotkeyEditor({ captureKey, replaceHotkeyOverrides }) {
        const cancelCapture = useCallback(() => {
          replaceHotkeyOverrides({});
        }, [replaceHotkeyOverrides]);

        useEffect(() => {
          if (!captureKey) return undefined;
          const handleKeyDown = (event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelCapture();
              return;
            }
          };
          window.addEventListener("keydown", handleKeyDown, true);
          return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
          };
        }, [captureKey, cancelCapture]);
        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when listener capture modes do not match", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Modal = ({ isOpen, onClose }) => {
        useEffect(() => {
          if (!isOpen) return;
          const handleKeyDown = (event) => {
            if (event.key === "Escape") onClose();
          };
          document.addEventListener("keydown", handleKeyDown, true);
          return () => document.removeEventListener("keydown", handleKeyDown, false);
        }, [isOpen, onClose]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when boolean and string listener capture arguments do not match", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Modal = ({ isOpen, onClose }) => {
        useEffect(() => {
          if (!isOpen) return;
          const handleKeyDown = (event) => {
            if (event.key === "Escape") onClose();
          };
          document.addEventListener("keydown", handleKeyDown, false);
          return () => document.removeEventListener("keydown", handleKeyDown, "false");
        }, [isOpen, onClose]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not crash while recovering malformed sparse listener arguments", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Modal = ({ isOpen, onClose }) => {
        useEffect(() => {
          if (!isOpen) return;
          const handleKeyDown = () => onClose();
          document.addEventListener("keydown", handleKeyDown, , true);
          return () => document.removeEventListener("keydown", handleKeyDown, , true);
        }, [isOpen, onClose]);
        return null;
      };
    `);

    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });
});
