function Component(props) {
  let a, bb, rest;
  ({a, b: bb, ...rest} = props.obj);
  return <div>{a}{bb}{rest}</div>;
}
