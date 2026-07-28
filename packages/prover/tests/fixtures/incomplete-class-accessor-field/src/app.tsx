import { Component } from "react";

export class Counter extends Component {
  accessor count = 0;

  render() {
    return <output>{this.count}</output>;
  }
}
