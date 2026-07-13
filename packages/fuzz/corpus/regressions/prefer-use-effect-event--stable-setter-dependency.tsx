// rule: prefer-use-effect-event
// weakness: library-idiom
// source: react-bench write-react-sahil87-run-kit-282__7jJuPUp
import { useCallback, useEffect, useState } from "react";

export const Composer = ({ open }: { open: boolean }) => {
  const [, setComposeOpen] = useState(false);
  const openComposeWithUploads = useCallback(() => {
    setComposeOpen(true);
  }, [setComposeOpen]);

  useEffect(() => {
    if (!open) return;
    const timeoutId = setTimeout(() => openComposeWithUploads(), 100);
    return () => clearTimeout(timeoutId);
  }, [openComposeWithUploads, open]);

  return null;
};
