import { Component } from "react";

class Clock extends Component {
  #timer: ReturnType<typeof setInterval> | undefined;

  componentDidMount() {
    this.#timer = setInterval(() => {}, 1000);
  }

  componentWillUnmount() {
    this.#stop();
  }

  #stop() {
    clearInterval(this.#timer);
  }

  render() {
    return null;
  }
}

export const App = () => <Clock />;
