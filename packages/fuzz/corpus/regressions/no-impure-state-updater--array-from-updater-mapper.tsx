// rule: no-impure-state-updater
// verdict: fail
// weakness: Array.from result callback provenance
// source: synthetic
import { useState } from "react";

export const Preview = ({ source, consume }) => {
  const [items, setItems] = useState([]);
  const incoming = Array.from(source);
  const update = () =>
    setItems(() =>
      incoming.map((item) => {
        localStorage.setItem("entry", item);
        return item;
      }),
    );
  return <button onClick={update}>{items.length}</button>;
};
