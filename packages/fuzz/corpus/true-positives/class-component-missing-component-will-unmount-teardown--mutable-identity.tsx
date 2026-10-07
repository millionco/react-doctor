// rule: class-component-missing-component-will-unmount-teardown
// weakness: copy-tracking
// source: parity audit
// verdict: fail

class Listener extends React.Component {
  componentDidMount() {
    this.bus.on("change", this.handler);
    this.handler = this.nextHandler;
  }

  componentWillUnmount() {
    this.bus.off("change", this.handler);
  }

  render() {
    return null;
  }
}
