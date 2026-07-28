import { Component as ReactView } from "react";

interface GreetingProperties {
  name: string;
}

export class Greeting extends ReactView<GreetingProperties> {
  render() {
    return <p>Hello {this.props.name}</p>;
  }
}
