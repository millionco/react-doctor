// rule: no-ref-callback-cleanup-before-react-19
// weakness: cleanup-action-identity
// verdict: fail

export const RefTile = () => {
  const slots = {
    "left.right": new Map<string, HTMLLIElement>(),
    left: { right: new Map<string, HTMLLIElement>() },
  };
  return (
    <li
      ref={(entry) => {
        if (entry) slots["left.right"].set("tile", entry);
        else slots["left.right"].delete("tile");
        return () => {
          slots.left.right.delete("tile");
        };
      }}
    >
      Tile
    </li>
  );
};
