function Component(props) {
  let a;
  [a] = props;
  return () => a;
}
