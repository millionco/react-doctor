// rule: class-component-missing-component-will-unmount-teardown
// weakness: identity-provenance
// source: PR #1000 deep adversarial audit
import { setInterval } from "custom-scheduler";

export class Clock extends React.Component {
  componentDidMount() {
    setInterval(this.tick, 1000);
  }

  render() {
    return null;
  }
}
