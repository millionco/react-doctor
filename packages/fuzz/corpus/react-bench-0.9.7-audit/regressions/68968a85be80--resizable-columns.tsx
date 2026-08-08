// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 68968a85be806aec4d1c02ef0e45de0e9ac73bf5ebaf8cdf6fa18dff42a8b1a0
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveColumnWidths, useSavedColumnWidths } from './column-widths-cookie';

const MINIMUM_COLUMN_WIDTH_PX = 60;

export const useResizableColumns = (
  cookieName: string,
  defaultWidths: Record<string, number>,
) => {
  const savedWidths = useSavedColumnWidths(cookieName);
  const [resizedWidths, setResizedWidths] = useState<Record<string, number>>({});
  const widths = useMemo(
    () => ({ ...defaultWidths, ...savedWidths, ...resizedWidths }),
    [defaultWidths, resizedWidths, savedWidths],
  );

  const widthsRef = useRef(widths);
  const resizedRef = useRef(resizedWidths);
  const defaultRef = useRef(defaultWidths);
  const savedRef = useRef(savedWidths);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);
  useEffect(() => {
    resizedRef.current = resizedWidths;
  }, [resizedWidths]);
  useEffect(() => {
    defaultRef.current = defaultWidths;
  }, [defaultWidths]);
  useEffect(() => {
    savedRef.current = savedWidths;
  }, [savedWidths]);

  const activeListenersRef = useRef<{
    onMouseMove: (e: MouseEvent) => void;
    onMouseUp: (e: MouseEvent) => void;
  } | null>(null);
  const originalUserSelectRef = useRef<string | null>(null);

  const cleanupWithRestore = useCallback(() => {
    const listeners = activeListenersRef.current;
    if (listeners) {
      document.removeEventListener('mousemove', listeners.onMouseMove);
      document.removeEventListener('mouseup', listeners.onMouseUp);
      activeListenersRef.current = null;
    }
    if (originalUserSelectRef.current !== null) {
      document.body.style.userSelect = originalUserSelectRef.current;
      originalUserSelectRef.current = null;
    }
  }, []);

  const cleanupForReplacement = useCallback(() => {
    const listeners = activeListenersRef.current;
    if (listeners) {
      document.removeEventListener('mousemove', listeners.onMouseMove);
      document.removeEventListener('mouseup', listeners.onMouseUp);
      activeListenersRef.current = null;
    }
    // keep originalUserSelectRef and keep userSelect = 'none'
  }, []);

  const startResize = useCallback(
    (columnKey: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (activeListenersRef.current) {
        cleanupForReplacement();
      }

      const currentWidths = widthsRef.current;
      const initialPointerX = event.clientX;
      const initialWidth = currentWidths[columnKey] ?? MINIMUM_COLUMN_WIDTH_PX;

      if (originalUserSelectRef.current === null) {
        originalUserSelectRef.current = document.body.style.userSelect;
      }
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const width = Math.max(
          MINIMUM_COLUMN_WIDTH_PX,
          Math.round(initialWidth + moveEvent.clientX - initialPointerX),
        );
        resizedRef.current = { ...resizedRef.current, [columnKey]: width };
        setResizedWidths((current) => ({ ...current, [columnKey]: width }));
      };

      const handleMouseUp = () => {
        cleanupWithRestore();
        const finalMerged = {
          ...defaultRef.current,
          ...savedRef.current,
          ...resizedRef.current,
        };
        saveColumnWidths(cookieName, finalMerged);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      activeListenersRef.current = { onMouseMove: handleMouseMove, onMouseUp: handleMouseUp };
    },
    [cleanupForReplacement, cleanupWithRestore, cookieName],
  );

  useEffect(() => {
    return () => {
      const listeners = activeListenersRef.current;
      if (listeners) {
        document.removeEventListener('mousemove', listeners.onMouseMove);
        document.removeEventListener('mouseup', listeners.onMouseUp);
        activeListenersRef.current = null;
      }
      if (originalUserSelectRef.current !== null) {
        document.body.style.userSelect = originalUserSelectRef.current;
        originalUserSelectRef.current = null;
      }
    };
  }, []);

  return { widths, startResize };
};

interface ColumnResizeHandleProps {
  columnLabel: string;
  width: number;
  onResizeStart: (event: React.MouseEvent) => void;
}

export const ColumnResizeHandle = ({
  columnLabel,
  width,
  onResizeStart,
}: ColumnResizeHandleProps) => (
  <div
    role="separator"
    aria-label={`Resize ${columnLabel} column`}
    aria-orientation="vertical"
    aria-valuemin={MINIMUM_COLUMN_WIDTH_PX}
    aria-valuenow={width}
    onMouseDown={onResizeStart}
    onClick={(event) => event.stopPropagation()}
    className="hover:bg-primary/50 absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize select-none"
  />
);
