import { Component } from "react";

export class Clock extends Component {
  render() {
    return <time>{Date.now()}</time>;
  }
}
