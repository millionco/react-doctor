function Component(props) {
  function helper(x) {
    return x + props.base;
  }
  return helper(1);
}
