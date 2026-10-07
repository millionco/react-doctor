// verdict: pass
// rule: no-prop-callback-in-effect
// weakness: library-idiom
// source: React Bench write-react-softmaple-softmaple__Adkr5Zd

const Editor = ({ textareaRef, onRemoteSelectionMapperChange }) => {
  const mapRemoteSelection = useRemoteSelectionMapper(textareaRef);

  useEffect(() => {
    onRemoteSelectionMapperChange?.(mapRemoteSelection);
    return () => onRemoteSelectionMapperChange?.(null);
  }, [mapRemoteSelection, onRemoteSelectionMapperChange]);

  return null;
};
