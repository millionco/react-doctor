// rule: no-prop-callback-in-render
// weakness: constructor-phase
import React from "react";

export class ReadyNotice extends React.Component {
  constructor(props) {
    super(props);
    const { notifyReady } = props;
    notifyReady();
  }
  render() {
    return <output />;
  }
}
