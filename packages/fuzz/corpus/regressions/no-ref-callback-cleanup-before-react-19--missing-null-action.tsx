// rule: no-ref-callback-cleanup-before-react-19
// weakness: cleanup-action-identity
// verdict: fail
import { useRef } from "react";

export const RefTile = () => {
  const slots = useRef(new Map<string, HTMLLIElement>());
  return (
    <li
      ref={(entry) => {
        if (entry) slots.current.set("tile", entry);
        return () => {
          slots.current.delete("tile");
        };
      }}
    >
      Tile
    </li>
  );
};
