// rule: class-component-missing-component-will-unmount-teardown
// weakness: control-flow
// source: synthetic
import React from "react";

class MatcherComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = { matchers: this.createMatchers(props.queries) };
  }

  createMatchers = (queries) =>
    Object.keys(queries).reduce(
      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),
      {},
    );

  onChange = () => {
    this.setState({ changed: true });
  };

  componentDidMount() {
    if (this.state.matchers) {
      const { onChange } = this;
      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));
    }
  }

  componentWillUnmount() {
    if (this.state.matchers) {
      const { onChange } = this;
      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));
    }
  }

  render() {
    return null;
  }
}

export { MatcherComponent };
