// rule: no-did-update-set-state
// weakness: alternate-branch-prop-diff
// source: PR 1335 review

import React from "react";

export class Profile extends React.Component {
  componentDidUpdate(previousProps) {
    if (previousProps.name === this.props.name) {
      return;
    } else {
      this.setState({ draftName: this.props.name });
    }
  }
}
