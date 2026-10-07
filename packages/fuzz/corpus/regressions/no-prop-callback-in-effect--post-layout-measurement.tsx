// verdict: pass
// rule: no-prop-callback-in-effect
// weakness: library-idiom
// source: React Bench write-react-pedropalau-react-bnb__hx5GPid

const Photo = ({ photo, onViewportSize }) => {
  const buttonRef = useRef(null);
  const measureViewport = useCallback(() => {
    const rect = buttonRef.current.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, []);

  useLayoutEffect(() => {
    const { width, height } = measureViewport();
    onViewportSize?.(width, height);
  }, [measureViewport, onViewportSize, photo]);

  return <button ref={buttonRef} />;
};
