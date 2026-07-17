import React from "react";

export class App extends React.Component {
  refresh = () => this.forceUpdate();

  componentDidMount() {
    setTimeout(() => this.refresh(), 500);
  }

  render() {
    return <div />;
  }
}
