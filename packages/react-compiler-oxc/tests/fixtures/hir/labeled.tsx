function Component(a) {
  outer: while (a) { continue outer; }
  return a;
}
