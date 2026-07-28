import { Component } from "react";

interface SearchProperties {
  query: string;
  scope: string;
}

interface SearchState {
  revision: number;
}

export class SearchResults extends Component<SearchProperties, SearchState> {
  componentDidUpdate(previousProperties: SearchProperties) {
    if (
      previousProperties.query !== this.props.query ||
      previousProperties.scope !== this.props.scope
    ) {
      this.setState({ revision: 1 });
    }
  }

  render() {
    return null;
  }
}
