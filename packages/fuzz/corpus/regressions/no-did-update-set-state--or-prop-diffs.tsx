// rule: no-did-update-set-state
// weakness: disjunctive-prop-diff
// source: PR 1335 review

import React from "react";

export class Profile extends React.Component {
  componentDidUpdate(previousProps) {
    if (previousProps.name !== this.props.name || previousProps.email !== this.props.email) {
      this.setState({ draft: this.props });
    }
  }
}
