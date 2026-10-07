// rule: no-prop-callback-in-effect
// weakness: library-idiom
// source: Daytona parity for RDFPFN batch
// verdict: pass

function GalleryDropZone({ onFileSelect }) {
  const dragProps = useDragDrop();
  const handleFileSelect = useCallback((file) => dragProps.onDrop(file), [dragProps]);

  useEffect(() => {
    onFileSelect?.(handleFileSelect);
  }, [onFileSelect, handleFileSelect]);

  return null;
}
