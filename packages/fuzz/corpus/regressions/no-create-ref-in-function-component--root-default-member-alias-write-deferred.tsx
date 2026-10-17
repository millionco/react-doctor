// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef } from "react";
interface PanelProps {
  options: { active: boolean };
}
interface InputOptions {
  value?: { active: boolean };
}
export const Panel = (props: PanelProps) => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  const options: InputOptions = {};
  const { value = props.options } = options;
  value.active = false;
  if (props.options.active) makeRef();
  return <div />;
};
