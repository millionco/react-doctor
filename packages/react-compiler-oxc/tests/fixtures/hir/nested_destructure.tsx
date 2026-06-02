function Component(props) {
  const { a, b: { c }, ...rest } = props;
  return a;
}
