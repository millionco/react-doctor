/* eslint-disable no-constant-condition, no-unused-expressions -- Deliberate parser-only regression shapes. */
// rule: rerender-functional-setstate
// verdict: pass
// weakness: control-flow
// source: synthetic awaited-continuation review

import { useState } from "react";
export const Example = ({ read, flag }) => {
  const [items, setItems] = useState([]);
  const handle = async () => {
    for (let index = 0; index < 1; index++) {
      if (!flag) continue;
      await read();
    }
    if (flag) return;
    setItems([...items, 1]);
  };
  return <button onClick={handle} />;
};

export const LogicalContinuation = ({ read, flag }) => {
  const [items, setItems] = useState([]);
  const handle = async () => {
    for (let index = 0; index < 1; index++) {
      if (!flag) continue;
      await read();
    }
    !flag && setItems([...items, 1]);
  };
  return <button onClick={handle} />;
};

export const TernaryContinuation = ({ read, flag }) => {
  const [items, setItems] = useState([]);
  const handle = async () => {
    for (let index = 0; index < 1; index++) {
      if (!flag) continue;
      await read();
    }
    flag ? null : setItems([...items, 1]);
  };
  return <button onClick={handle} />;
};

export const OuterCondition = ({ read, flag }) => {
  const [items, setItems] = useState([]);
  const handle = async () => {
    if (flag) {
      for (let index = 0; index < 1; index++) {
        if (flag) continue;
        await read();
      }
      setItems([...items, 1]);
    }
  };
  return <button onClick={handle} />;
};

export const ExhaustiveContinueGuards = ({ read, flag }) => {
  const [items, setItems] = useState([]);
  const handle = async () => {
    for (let index = 0; index < 1; index++) {
      if (flag) continue;
      if (!flag) continue;
      await read();
    }
    setItems([...items, 1]);
  };
  return <button onClick={handle} />;
};

export const CompositeContinueGuard = ({ read, flag }) => {
  const [items, setItems] = useState([]);
  const handle = async () => {
    for (let index = 0; index < 1; index++) {
      if (flag || true) continue;
      await read();
    }
    setItems([...items, 1]);
  };
  return <button onClick={handle} />;
};
