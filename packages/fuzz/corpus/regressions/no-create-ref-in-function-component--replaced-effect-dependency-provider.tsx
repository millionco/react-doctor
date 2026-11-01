// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import React, { createRef, useRef, useEffect } from "react";
declare const replacementEffect: typeof useEffect;
React.useEffect = replacementEffect;
interface PanelProps {
  active: boolean;
}
export const Panel = (props: PanelProps) => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  if (props.active) makeRef();
  useEffect(() => {
    refs.current[0]?.current?.focus();
  }, [props.active]);
  return <div />;
};
