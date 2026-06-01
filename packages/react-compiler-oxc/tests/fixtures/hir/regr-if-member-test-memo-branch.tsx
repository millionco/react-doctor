function Component(props) {
  let data;
  if (props.cond) {
    data = compute(props.a);
  } else {
    data = compute(props.b);
  }
  return <span>{data}</span>;
}
