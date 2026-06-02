function Component(props) {
  let sum = 0;
  for (let i = 0, j = props.n; i < j; i++) {
    sum += i;
  }
  return sum;
}
