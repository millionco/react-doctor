function Component(props) {
  const obj = { a: 1, [k]: 2, ...rest };
  const arr = [1, , props.x, ...rest];
  return obj;
}
