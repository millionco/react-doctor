// rule: no-ref-callback-cleanup-before-react-19
// weakness: cleanup-action-identity
// verdict: pass
import { useRef } from "react";

export const RefTile = () => {
  const slots = useRef(new Map<string, HTMLLIElement>());
  return (
    <li
      ref={(entry) => {
        if (entry) slots.current.set("tile", entry);
        else slots.current.delete("tile");
        return () => {
          slots.current.delete("tile");
        };
      }}
    >
      Tile
    </li>
  );
};
