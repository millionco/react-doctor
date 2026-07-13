// rule: prefer-use-effect-event
// weakness: library-idiom
// source: react-bench write-react-sahil87-run-kit-282__7jJuPUp
import { useCallback, useEffect, useRef, useState } from "react";

export const NotificationControl = ({ open }: { open: boolean }) => {
  const [, setIsOpen] = useState(open);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeAndFocusTrigger = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAndFocusTrigger();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeAndFocusTrigger, open]);

  return <button ref={triggerRef}>Notifications</button>;
};
