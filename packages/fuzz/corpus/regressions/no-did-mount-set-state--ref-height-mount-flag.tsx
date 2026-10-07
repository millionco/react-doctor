// rule: no-did-mount-set-state
// weakness: post-mount-source
// source: ReactBench sneljo1/auryo@5180622e43d236feaebd00013f3d78e93f02cac1
// verdict: pass

import React from "react";

class ToggleMore extends React.PureComponent {
  overflow = React.createRef();

  componentDidMount() {
    if (this.overflow.current) {
      const height = this.overflow.current.clientHeight;
      if (height > this.state.checkHeight && !this.state.overflow) {
        this.setState({
          overflow: true,
          max: height,
        });
      }
    }
  }
}
