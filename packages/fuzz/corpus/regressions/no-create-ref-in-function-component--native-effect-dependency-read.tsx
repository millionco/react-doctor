// rule: no-create-ref-in-function-component
// verdict: fail
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef, useEffect } from "react";
interface ItemSource {
  read: () => string[];
}
interface PanelProps {
  source: ItemSource;
}
export const Panel = (props: PanelProps) => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  const items = props.source.read();
  if (items.length) makeRef();
  useEffect(() => {
    refs.current[0]?.current?.focus();
  }, [props.source]);
  return <div />;
};
