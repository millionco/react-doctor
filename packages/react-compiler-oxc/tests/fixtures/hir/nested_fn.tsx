function Component(props) {
  const cb = () => { props.setCount(props.count + 1); };
  return cb;
}
