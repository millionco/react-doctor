// rule: class-component-missing-component-will-unmount-teardown
// weakness: default-parameter
// verdict: fail
// source: independent synthetic stable matcher runtime binding review
class Setup {
  constructor(
    public value = Function(
      "let calls = 0; const originalValues = Object.values; Object.values = record => ++calls === 1 ? originalValues(record) : [];",
    )(),
  ) {}
}
new Setup();
import React from "react";
interface ListenerProps {
  queries: Record<string, string>;
}
export const createListenerComponents = () => ({
  Provider: class ListenerProvider extends React.Component<ListenerProps> {
    constructor(props: ListenerProps) {
      super(props);
      this.state = {
        matchers: this.setupMatchers(props.queries),
        changeCount: 0,
      };
    }
    setupMatchers = (queries: Record<string, string>) =>
      Object.keys(queries).reduce(
        (matchers, queryKey) => ({
          ...matchers,
          [queryKey]: window.matchMedia(queries[queryKey]),
        }),
        {},
      );
    handleChange = () => {
      this.setState({ changeCount: 1 });
    };
    componentDidMount() {
      if (this.state.matchers) {
        const { handleChange } = this;
        Object.values(this.state.matchers).forEach((matcher) => {
          matcher.addListener(handleChange);
        });
      }
    }
    componentWillUnmount() {
      if (this.state.matchers) {
        const { handleChange } = this;
        Object.values(this.state.matchers).forEach((matcher) => {
          matcher.removeListener(handleChange);
        });
      }
    }
    render() {
      return null;
    }
  },
});
