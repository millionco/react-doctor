// rule: no-prop-callback-in-effect
// weakness: library-idiom
// source: Daytona parity for RDFPFN batch
// verdict: pass

function NameCell({ id, onSetNameCellFns }) {
  const { setValue } = useField();
  const open = useCallback(() => setValue(""), [setValue]);

  useEffect(() => {
    onSetNameCellFns((previous) => ({ ...previous, [id]: { open } }));
  }, [id, open, onSetNameCellFns]);

  return null;
}
