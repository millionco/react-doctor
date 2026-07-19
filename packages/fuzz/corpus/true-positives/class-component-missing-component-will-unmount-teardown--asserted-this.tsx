import React from "react";

export class App extends React.Component {
  componentDidMount() {
    setTimeout(() => {
      const updateReady = () => (this as any).setState({ ready: true });
      updateReady();
    }, 500);
  }

  render() {
    return <div />;
  }
}
