// rule: no-did-mount-set-state
// weakness: post-mount-callback-ref
// source: ReactBench fix-react-rdh-hacker0x01-react-d__3UEZkbb
// verdict: pass

import { Component } from "react";

class Calendar extends Component {
  monthContainer = undefined;

  setMonthContainerRef = (element) => {
    this.monthContainer = element ?? undefined;
  };

  componentDidMount() {
    if (this.props.showTimeSelect) {
      this.setState({ monthContainer: this.monthContainer });
    }
  }

  render() {
    return <div ref={this.setMonthContainerRef} />;
  }
}
