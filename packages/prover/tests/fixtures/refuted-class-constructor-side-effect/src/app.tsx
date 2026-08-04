import { Component } from "react";

export class Counter extends Component {
  constructor(properties: Record<string, unknown>) {
    super(properties);
    console.log("constructed");
  }

  render() {
    return null;
  }
}
