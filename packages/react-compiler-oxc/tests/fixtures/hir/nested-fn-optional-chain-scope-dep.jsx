function Component(props) {
  const object = useMemo(() => {
    const a = () => {
      props?.onA?.();
    };
    const b = () => {
      props?.onB?.();
    };
    return { b, a };
  }, [props]);
  return object;
}
