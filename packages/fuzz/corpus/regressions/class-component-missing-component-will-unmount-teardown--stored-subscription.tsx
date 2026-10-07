// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: parity audit
// verdict: pass

class Listener extends React.Component {
  componentDidMount() {
    this.subscription = store.subscribe(this.handleChange);
  }

  componentWillUnmount() {
    this.subscription.unsubscribe();
  }

  render() {
    return null;
  }
}
