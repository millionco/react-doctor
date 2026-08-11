// rule: effect-needs-cleanup
// file-path: apps/framework-editor/app/components/table/resizable-columns.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 8a59e47725ec5b98b0b369ead20b20b36fd0cfd5bf02a7ee0f4b61479360794a
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MIN_COLUMN_WIDTH_PX,
  saveColumnWidths,
  useSavedColumnWidths,
} from './column-widths-cookie';

export { MIN_COLUMN_WIDTH_PX };

const mergeColumnWidths = (
  defaultWidths: Record<string, number>,
  savedWidths: Record<string, number>,
  resizedWidths: Record<string, number>,
): Record<string, number> =>
  Object.fromEntries(
    Object.keys(defaultWidths).map((columnKey) => {
      const defaultWidth = defaultWidths[columnKey] ?? MIN_COLUMN_WIDTH_PX;
      const width = resizedWidths[columnKey] ?? savedWidths[columnKey] ?? defaultWidth;
      return [columnKey, Math.max(MIN_COLUMN_WIDTH_PX, Math.round(width))];
    }),
  );

export const useResizableColumns = (
  cookieName: string,
  defaultWidths: Record<string, number>,
) => {
  const savedWidths = useSavedColumnWidths(cookieName);
  const [resizedWidths, setResizedWidths] = useState<Record<string, number>>({});
  const widths = useMemo(
    () => mergeColumnWidths(defaultWidths, savedWidths, resizedWidths),
    [defaultWidths, resizedWidths, savedWidths],
  );
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const dragListenersRef = useRef<{
    handleMouseMove: (event: MouseEvent) => void;
    handleMouseUp: (event: MouseEvent) => void;
  } | null>(null);
  const priorUserSelectRef = useRef('');

  const finishDrag = useCallback(
    (persist: boolean) => {
      const listeners = dragListenersRef.current;
      if (!listeners) {
        return;
      }

      document.removeEventListener('mousemove', listeners.handleMouseMove);
      document.removeEventListener('mouseup', listeners.handleMouseUp);
      document.body.style.userSelect = priorUserSelectRef.current;
      dragListenersRef.current = null;

      if (persist) {
        saveColumnWidths(cookieName, widthsRef.current);
      }
    },
    [cookieName],
  );

  const startResize = useCallback(
    (columnKey: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      finishDrag(false);

      const initialPointerX = event.clientX;
      const initialWidth = widthsRef.current[columnKey] ?? MIN_COLUMN_WIDTH_PX;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const width = Math.max(
          MIN_COLUMN_WIDTH_PX,
          Math.round(initialWidth + moveEvent.clientX - initialPointerX),
        );
        widthsRef.current = { ...widthsRef.current, [columnKey]: width };
        setResizedWidths((currentWidths) => ({ ...currentWidths, [columnKey]: width }));
      };

      const handleMouseUp = () => {
        finishDrag(true);
      };

      priorUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      dragListenersRef.current = { handleMouseMove, handleMouseUp };
    },
    [finishDrag],
  );

  useEffect(() => () => finishDrag(false), [finishDrag]);

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
    aria-valuemin={MIN_COLUMN_WIDTH_PX}
    aria-valuenow={width}
    onMouseDown={onResizeStart}
    onClick={(event) => event.stopPropagation()}
    className="hover:bg-primary/50 absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize select-none"
  />
);
