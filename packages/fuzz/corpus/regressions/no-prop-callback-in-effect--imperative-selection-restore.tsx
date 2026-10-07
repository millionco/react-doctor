// verdict: pass
// rule: no-prop-callback-in-effect
// weakness: library-idiom
// source: React Bench write-react-softmaple-softmaple__A8YcMdS

const Editor = ({ textareaRef, text, pendingSelection, onPendingSelectionApplied }) => {
  const selectionSync = useTextareaSelectionSync(textareaRef);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element || !pendingSelection) return;
    element.value = text;
    selectionSync.restoreSelection(pendingSelection);
    onPendingSelectionApplied?.(null);
  }, [text, textareaRef, pendingSelection, selectionSync, onPendingSelectionApplied]);

  return null;
};
