// rule: no-did-mount-set-state
// weakness: post-mount-callback-ref
// source: adversarial audit of ReactBench fix-react-rdh-hacker0x01-react-d__3UEZkbb
// verdict: fail

import { Component } from "react";

class Calendar extends Component {
  monthContainer = undefined;

  setMonthContainerRef = (element) => {
    this.monthContainer = element ?? undefined;
  };

  replaceMonthContainer = (value) => {
    this.monthContainer = value;
  };

  componentDidMount() {
    this.setState({ monthContainer: this.monthContainer });
  }

  render() {
    return (
      <>
        <div ref={this.setMonthContainerRef} />
        <button onClick={() => this.replaceMonthContainer(this.props.value)}>Replace</button>
      </>
    );
  }
}
