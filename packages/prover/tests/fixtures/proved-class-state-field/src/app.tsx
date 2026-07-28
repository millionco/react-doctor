import { Component } from "react";

export class Counter extends Component {
  state = { count: 0 };

  render() {
    return <p>{this.state.count}</p>;
  }
}
