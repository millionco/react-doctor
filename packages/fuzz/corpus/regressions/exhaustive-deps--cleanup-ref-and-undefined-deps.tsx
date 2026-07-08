// rule: exhaustive-deps
// weakness: cleanup-ref-assignment, explicit-undefined-deps
// source: differential vs eslint-plugin-react-hooks (seanime video-core-drawer, next.js layout-router)
import { useEffect, useLayoutEffect, useRef } from "react";

export const DraggableArea = () => {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const attach = (node: HTMLDivElement | null) => {
    areaRef.current = node;
  };
  useEffect(() => {
    const handleMouseDown = () => {};
    areaRef.current?.addEventListener("mousedown", handleMouseDown);
    return () => {
      areaRef.current?.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);
  return <div ref={attach} />;
};

export const EveryCommitEffect = ({
  focusAndScrollRef,
}: {
  focusAndScrollRef: { apply: boolean };
}) => {
  useLayoutEffect(() => {
    focusAndScrollRef.apply = false;
  }, undefined);
  return null;
};
