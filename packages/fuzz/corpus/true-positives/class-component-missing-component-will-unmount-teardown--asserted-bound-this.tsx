import React from "react";

export class App extends React.Component {
  refresh = () => this.setState({ ready: true });

  componentDidMount() {
    setTimeout(this.refresh.bind(this as any), 500);
  }

  render() {
    return <div />;
  }
}
