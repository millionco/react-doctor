// rule: class-component-missing-component-will-unmount-teardown
// weakness: alias-guard
// source: parity audit
// verdict: pass

class Listener extends React.Component {
  componentDidMount() {
    emitter.on("change", this.handleChange);
  }

  componentWillUnmount() {
    emitter.removeListener("change", this.handleChange);
  }

  handleChange() {}

  render() {
    return null;
  }
}
