// rule: class-component-missing-component-will-unmount-teardown
// weakness: control-flow
// source: parity audit
// verdict: fail

export class Listener extends React.Component {
  componentDidMount(): void {
    emitter.on("change", this.handleChange);
  }

  componentWillUnmount(): void {
    mayThrow();
    emitter.off("change", this.handleChange);
  }

  handleChange = (): void => {};

  render(): React.ReactNode {
    return null;
  }
}
