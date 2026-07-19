import React from "react";

export class CastListenerHelperCall extends React.Component {
  componentDidMount() {
    const attach = () => window.addEventListener("resize", this.onResize);
    (attach as typeof attach)();
  }

  onResize = () => {};

  render() {
    return null;
  }
}
