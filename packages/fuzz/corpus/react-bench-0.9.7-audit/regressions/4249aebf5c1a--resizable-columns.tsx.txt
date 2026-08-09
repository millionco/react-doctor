// rule: effect-needs-cleanup
// file-path: apps/framework-editor/app/components/table/resizable-columns.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 4249aebf5c1ae9f826a34b0d7743830e6c63489baa5467c4fdb449751a1b4891
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
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const originalUserSelectRef = useRef<string | null>(null);
  const activeListenersRef = useRef<{
    handleMouseMove: (e: MouseEvent) => void;
    handleMouseUp: (e: MouseEvent) => void;
  } | null>(null);

  const removeActiveListeners = useCallback(() => {
    const listeners = activeListenersRef.current;
    if (listeners) {
      document.removeEventListener('mousemove', listeners.handleMouseMove);
      document.removeEventListener('mouseup', listeners.handleMouseUp);
      activeListenersRef.current = null;
    }
  }, []);

  const restoreUserSelect = useCallback(() => {
    if (originalUserSelectRef.current !== null) {
      document.body.style.userSelect = originalUserSelectRef.current;
      originalUserSelectRef.current = null;
    }
  }, []);

  const activeCleanup = useRef<(() => void) | null>(null);

  const startResize = useCallback(
    (columnKey: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // If a drag is being replaced, its cleanup path must restore text selection
      // and stop listeners. Width reached remains via resizedWidths state.
      if (activeCleanup.current) {
        activeCleanup.current();
      }

      const initialPointerX = event.clientX;
      const currentWidths = widthsRef.current;
      const initialWidth = currentWidths[columnKey] ?? defaultWidths[columnKey] ?? MINIMUM_COLUMN_WIDTH_PX;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const width = Math.max(
          MINIMUM_COLUMN_WIDTH_PX,
          Math.round(initialWidth + moveEvent.clientX - initialPointerX),
        );
        setResizedWidths((cur) => ({ ...cur, [columnKey]: width }));
      };

      const cleanupAndRestore = () => {
        removeActiveListeners();
        restoreUserSelect();
        activeCleanup.current = null;
      };

      const handleMouseUp = () => {
        cleanupAndRestore();
        saveColumnWidths(cookieName, widthsRef.current);
      };

      if (originalUserSelectRef.current === null) {
        originalUserSelectRef.current = document.body.style.userSelect;
      }
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      activeListenersRef.current = { handleMouseMove, handleMouseUp };

      activeCleanup.current = cleanupAndRestore;
    },
    [cookieName, defaultWidths, removeActiveListeners, restoreUserSelect],
  );

  useEffect(() => {
    return () => {
      activeCleanup.current?.();
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
