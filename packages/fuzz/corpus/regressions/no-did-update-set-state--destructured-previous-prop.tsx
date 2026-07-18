// rule: no-did-update-set-state
// weakness: alias-guard
// source: Cursor Bugbot on PR #1335

import React from "react";

export class Dropdown extends React.Component {
  componentDidUpdate({ value: previousValue }) {
    if (this.props.value === undefined && previousValue !== undefined) {
      this.setState({ selectedValue: undefined });
    }
  }
}
