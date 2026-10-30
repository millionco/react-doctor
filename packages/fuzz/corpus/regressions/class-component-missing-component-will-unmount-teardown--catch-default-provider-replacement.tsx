// rule: class-component-missing-component-will-unmount-teardown
// weakness: default-parameter
// verdict: fail
// source: synthetic regression
try {
  throw {};
} catch ({
  _ignored = Function(
    "const values=Object.values;let calls=0;Object.values=record=>++calls===1?values(record):[]",
  )(),
}) {
  void _ignored;
}
import React from "react";
interface FuzzCatchListenerProps {
  queries: Record<string, string>;
}
export const createFuzzCatchListenerComponents = () => ({
  Provider: class FuzzCatchListenerProvider extends React.Component<FuzzCatchListenerProps> {
    constructor(props: FuzzCatchListenerProps) {
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
