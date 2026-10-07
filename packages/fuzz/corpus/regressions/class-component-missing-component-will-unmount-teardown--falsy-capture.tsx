// rule: class-component-missing-component-will-unmount-teardown
// weakness: option-normalization
// source: parity audit
// verdict: pass

export class Listener extends React.Component {
  componentDidMount(): void {
    window.addEventListener("resize", this.handleResize, { capture: undefined });
  }

  componentWillUnmount(): void {
    window.removeEventListener("resize", this.handleResize);
  }

  handleResize = (): void => {};

  render(): React.ReactNode {
    return null;
  }
}
