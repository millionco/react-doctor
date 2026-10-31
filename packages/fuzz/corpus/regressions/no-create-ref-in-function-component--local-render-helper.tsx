// rule: no-create-ref-in-function-component
// verdict: fail
// weakness: wrapper-transparency
// source: synthetic

import * as React from "react";

interface ItemRef {
  current: HTMLDivElement | null;
}
interface ItemPanelProps {
  labels: string[];
}

export const ItemPanel = ({ labels }: ItemPanelProps) => {
  const refs = React.useRef<ItemRef[]>([]);
  const makeItemRef = () => {
    const ref = React.createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  const renderItem = (label: string) => <div ref={makeItemRef()}>{label}</div>;
  const nodes = [];
  for (let index = 0; index < labels.length; index++) nodes.push(renderItem(labels[index]));
  React.useEffect(() => {
    refs.current[0]?.current?.focus();
  }, []);
  return <section>{nodes}</section>;
};
