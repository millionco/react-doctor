// rule: no-reset-all-state-on-prop-change
// weakness: control-flow
// source: independently authored synthetic focus request
// verdict: pass
import { useEffect, useRef, useState } from "react";
const Action = ({ attach, choose }) => (
  <button ref={attach} onClick={choose}>
    Remove
  </button>
);
export const RowActions = ({ rows }) => {
  const fallback = useRef(null);
  const buttons = useRef(new Map());
  const previousKeys = useRef([]);
  const [ticket, setTicket] = useState(null);
  useEffect(() => {
    const keys = rows?.map((row) => row.key) || [];
    if (ticket !== null && rows) {
      const position = Math.min(ticket, rows.length - 1);
      const selected = rows[position];
      const target = selected ? buttons.current.get(selected.key) : null;
      if (target) target.focus();
      else if (fallback.current) fallback.current.focus();
      setTicket(null);
    }
    previousKeys.current = keys;
  }, [rows, ticket]);
  const chooseRow = (key) => {
    const position = previousKeys.current.indexOf(key);
    if (position >= 0) setTicket(position);
  };
  return (
    <section>
      {rows?.map((row) => (
        <Action
          key={row.key}
          choose={() => chooseRow(row.key)}
          attach={(element) => {
            if (element) buttons.current.set(row.key, element);
            else buttons.current.delete(row.key);
          }}
        />
      ))}
      <input ref={fallback} />
    </section>
  );
};
