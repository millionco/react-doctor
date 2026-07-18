import React from "react";
import { disposeOnUnmount } from "mobx-react";

export class Preview extends React.Component {
  componentDidMount() {
    disposeOnUnmount(this, () => {});
    window.addEventListener("resize", this.handleResize);
  }

  handleResize = () => this.setState({ width: window.innerWidth });

  render() {
    return null;
  }
}
