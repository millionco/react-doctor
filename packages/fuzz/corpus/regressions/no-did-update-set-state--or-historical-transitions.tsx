// rule: no-did-update-set-state
// weakness: control-flow
// source: PR 1335 review

import React from "react";

interface DropdownProps {
  mode: string;
  value?: string;
}

interface DropdownState {
  selectedValue: string | undefined;
}

export class Dropdown extends React.Component<DropdownProps, DropdownState> {
  state: DropdownState = { selectedValue: this.props.value };

  componentDidUpdate(previousProps: DropdownProps) {
    if (
      (this.props.value === undefined && previousProps.value !== undefined) ||
      (this.props.mode === "closed" && previousProps.mode !== "closed")
    ) {
      this.setState({ selectedValue: undefined });
    }
  }

  render() {
    return this.state.selectedValue ?? null;
  }
}
