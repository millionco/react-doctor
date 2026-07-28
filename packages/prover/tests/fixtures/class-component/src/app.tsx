import { Component } from "react";

interface WelcomeProperties {
  name: string;
}

export class Welcome extends Component<WelcomeProperties> {
  render() {
    return <h1>Hello {this.props.name}</h1>;
  }
}
