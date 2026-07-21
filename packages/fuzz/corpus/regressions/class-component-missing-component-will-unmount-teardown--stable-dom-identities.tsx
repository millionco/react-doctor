// rule: class-component-missing-component-will-unmount-teardown
// weakness: reference-identity
// source: parity audit
// verdict: pass

const handleResize = () => {};

export class Listener extends React.Component {
  componentDidMount(): void {
    mediaQuery.addListener(handleResize);
    window.visualViewport.addEventListener("resize", handleResize);
    document.body.addEventListener("click", handleResize);
  }

  componentWillUnmount(): void {
    mediaQuery.removeListener(handleResize);
    window.visualViewport.removeEventListener("resize", handleResize);
    document.body.removeEventListener("click", handleResize);
  }

  render(): React.ReactNode {
    return null;
  }
}
