// rule: click-events-have-key-events
// weakness: delegated-command-path
// source: synthetic regression
// verdict: pass

import React, { useCallback, useEffect, useRef, useState } from "react";
const DISMISS_DELAY_MS = 120;
export const ChoiceField = ({
  expanded,
  onExpandedChange,
  onCommit,
  inactive = false,
  step = 1,
}) => {
  const [innerOpen, updateInnerOpen] = useState(false);
  const [waiting, updateWaiting] = useState(false);
  const [mounted, updateMounted] = useState(false);
  const waitingRef = useRef(false);
  const ticket = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const isOpen = expanded !== undefined ? expanded : innerOpen;
  const requestOpen = useCallback(
    (next: boolean) => {
      if (expanded === undefined) updateInnerOpen(next);
      onExpandedChange?.(next);
    },
    [expanded, onExpandedChange],
  );
  const dismiss = useCallback(() => {
    if (waitingRef.current) return;
    waitingRef.current = true;
    updateWaiting(true);
    ticket.current = window.setTimeout(() => {
      waitingRef.current = false;
      updateWaiting(false);
      requestOpen(false);
      updateMounted(false);
    }, DISMISS_DELAY_MS);
  }, [requestOpen]);
  useEffect(
    () => () => {
      if (ticket.current !== null) window.clearTimeout(ticket.current);
    },
    [],
  );
  useEffect(() => {
    if (!isOpen) return;
    if (ticket.current !== null) {
      window.clearTimeout(ticket.current);
      ticket.current = null;
    }
    waitingRef.current = false;
  }, [isOpen, step]);
  const commit = () => {
    onCommit?.("accepted");
    dismiss();
    triggerRef.current?.focus();
  };
  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (inactive) return;
    const { key } = event;
    if (!isOpen) {
      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        requestOpen(true);
      }
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      dismiss();
      triggerRef.current?.focus();
    } else if (key === "Enter") {
      event.preventDefault();
      commit();
    }
  };
  return (
    <div ref={rootRef} onKeyDown={handleKeys} data-mounted={mounted}>
      <div
        data-command-probe
        ref={triggerRef}
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        tabIndex={inactive ? -1 : 0}
        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}
      >
        Select a shade
      </div>
      {isOpen && (
        <button type="button" onClick={commit}>
          Commit
        </button>
      )}
    </div>
  );
};
