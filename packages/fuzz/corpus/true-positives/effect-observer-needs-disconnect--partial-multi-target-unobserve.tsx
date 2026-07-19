// rule: effect-observer-needs-disconnect
// weakness: control-flow
// source: PR #1365 Bugbot 3603065906

export const Tracker = () => {
  useEffect(() => {
    {
      const observer = new ResizeObserver(callback);
      observer.observe(first);
      observer.observe(second);
      observer.unobserve(first);
    }
    {
      const observer = new ResizeObserver(callback);
      observer.observe(second);
    }
  }, []);
  return null;
};
