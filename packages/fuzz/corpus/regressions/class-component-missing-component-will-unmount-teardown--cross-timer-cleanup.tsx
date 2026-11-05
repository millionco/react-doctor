// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: synthetic
import { Component } from "react";

class Clock extends Component {
  timer: ReturnType<typeof setInterval> | undefined;

  componentDidMount() {
    this.timer = setInterval(() => this.forceUpdate(), 100);
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  render() {
    return null;
  }
}
