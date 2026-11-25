// rule: exhaustive-deps
// weakness: hook-return-provenance
import { useCallback, useRef } from "react";

const useLocalElement = () => {
  const element = useRef<HTMLDivElement | null>(null);
  return element;
};

export const Panel = () => {
  const holder = useLocalElement();
  const attach = useCallback((node: HTMLDivElement | null) => {
    holder.current = node;
  }, []);
  return <div ref={attach} />;
};
