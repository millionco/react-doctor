// rule: class-component-missing-component-will-unmount-teardown
// weakness: control-flow
// source: adversarial parity review
// verdict: fail

export class Listener extends React.Component {
  componentDidMount(): void {
    for (let index = 0; index < 3; index += 1) {
      emitter.on("change", this.handleChange);
    }
  }

  componentWillUnmount(): void {
    emitter.off("change", this.handleChange);
  }

  handleChange = (): void => {};
  render(): React.ReactNode {
    return null;
  }
}
