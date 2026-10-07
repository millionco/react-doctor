// rule: class-component-missing-component-will-unmount-teardown
// weakness: lifecycle-race
// source: parity audit
// verdict: fail

export class Listener extends React.Component {
  async componentDidMount(): Promise<void> {
    await prepare();
    emitter.on("change", this.handleChange);
  }

  componentWillUnmount(): void {
    emitter.off("change", this.handleChange);
  }

  handleChange = (): void => {};

  render(): React.ReactNode {
    return null;
  }
}

export class HelperListener extends React.Component {
  async componentDidMount(): Promise<void> {
    await prepare();
    this.attach();
  }

  attach(): void {
    emitter.on("change", this.handleChange);
  }

  componentWillUnmount(): void {
    emitter.off("change", this.handleChange);
  }

  handleChange = (): void => {};
  render(): React.ReactNode {
    return null;
  }
}

export class LocalHelperListener extends React.Component {
  async componentDidMount(): Promise<void> {
    const attach = (): void => emitter.on("change", this.handleChange);
    await prepare();
    attach();
  }

  componentWillUnmount(): void {
    emitter.off("change", this.handleChange);
  }

  handleChange = (): void => {};
  render(): React.ReactNode {
    return null;
  }
}
