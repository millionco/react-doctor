// rule: click-events-have-key-events, no-noninteractive-element-interactions, no-static-element-interactions
// weakness: provenance
// source: RDE PR 1203

import React from "react";

interface ModalProps {
  children: React.ReactNode;
}

export class Modal extends React.Component<ModalProps> {
  handleBoxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  render() {
    return (
      <div onClick={this.handleBoxClick as React.MouseEventHandler<HTMLDivElement>}>
        {this.props.children}
      </div>
    );
  }
}
