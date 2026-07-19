import React from "react";

export class App extends React.Component {
  componentDidMount() {
    setTimeout(() => {
      const updateReady = () => this!.setState({ ready: true });
      updateReady();
    }, 500);
  }

  render() {
    return <div />;
  }
}
