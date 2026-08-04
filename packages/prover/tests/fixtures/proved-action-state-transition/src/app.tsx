import { startTransition, useActionState } from "react";

interface SelectionState {
  selectedIds: ReadonlyArray<string>;
}

const selectItem = (previousState: SelectionState, itemId: string): SelectionState => ({
  selectedIds: [...previousState.selectedIds, itemId],
});

export const SelectionPanel = () => {
  const [selection, dispatchSelection, isPending] = useActionState(selectItem, {
    selectedIds: [],
  });
  const handleSelect = (itemId: string) => {
    startTransition(() => {
      dispatchSelection(itemId);
    });
  };

  return (
    <section>
      <button type="button" disabled={isPending} onClick={() => handleSelect("activity")}>
        Select activity
      </button>
      <output>{selection.selectedIds.join(", ")}</output>
    </section>
  );
};
