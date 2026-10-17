// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: provider-erasure
// source: independently synthetic binding namespace control
namespace require {
  export interface Marker {}
}
require("react").createRef = () => ({ current: null });
import * as React from "react";
import { createRef, useEffect, useRef, useState } from "react";
export const Panel = ({ active }) => {
  const refs = useRef([]);
  const makeRef = () => {
    const ref = createRef();
    refs.current.push(ref);
    return ref;
  };
  const renderItem = () => <div ref={makeRef()} />;
  return active ? renderItem() : null;
};
