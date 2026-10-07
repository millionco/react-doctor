// rule: class-component-missing-component-will-unmount-teardown
// weakness: control-flow
// source: adversarial parity review
// verdict: pass

export class Listener extends React.Component {
  async componentDidMount(): Promise<void> {
    if (this.skip) {
      await prepare();
      return;
    }
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

export class DeadLoopListener extends React.Component {
  componentDidMount(): void {
    for (; false; ) {
      emitter.on("change", this.handleChange);
    }
  }

  handleChange = (): void => {};
  render(): React.ReactNode {
    return null;
  }
}

export class DeadHelperListener extends React.Component {
  componentDidMount(): void {
    if (false) this.attach();
  }

  attach(): void {
    emitter.on("change", this.handleChange);
  }

  handleChange = (): void => {};
  render(): React.ReactNode {
    return null;
  }
}

export class PerIterationCleanupListener extends React.Component {
  componentDidMount(): void {
    for (const item of this.items) {
      emitter.on("change", this.handleChange);
      emitter.off("change", this.handleChange);
    }
  }

  handleChange = (): void => {};
  render(): React.ReactNode {
    return null;
  }
}
