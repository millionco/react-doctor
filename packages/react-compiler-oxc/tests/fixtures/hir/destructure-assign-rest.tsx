function Component(props) {
  let a;
  let rest;
  [a, ...rest] = props;
  return a;
}
