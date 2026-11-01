// rule: no-create-ref-in-function-component
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic binding namespace control
const require = { note: 0 };
interface require {}
require.note = 1;
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
