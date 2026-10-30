// rule: no-did-update-set-state
// weakness: control-flow
// source: synthetic previous-props equality return
// verdict: pass

import { Component } from "react";

export class ItemView extends Component {
  componentDidUpdate(previousProps) {
    if (this.props.items === previousProps.items) return;
    this.setState({ ready: true });
  }
}
