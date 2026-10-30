// rule: class-component-missing-component-will-unmount-teardown
// weakness: name-heuristic
// verdict: pass
// source: independent synthetic stable matcher runtime binding review
interface window {}
interface Object {}
import React from "react";
interface ListenerProps {
  queries: Record<string, string>;
}
export const createListenerComponents = () => ({
  Provider: class ListenerProvider extends React.Component<ListenerProps> {
    constructor(props: ListenerProps) {
      super(props);
      let nativeEntries = undefined;
      let summary = {};
      if (this.supportsQueries()) {
        nativeEntries = this.setupMatchers(props.queries);
        summary = this.readMatchers(nativeEntries);
      }
      this.state = { matchers: nativeEntries, summary, changeCount: 0 };
    }
    setupMatchers = (queries: Record<string, string>) =>
      Object.keys(queries).reduce(
        (matchers, queryKey) => ({
          ...matchers,
          [queryKey]: window.matchMedia(queries[queryKey]),
        }),
        {},
      );
    supportsQueries = () =>
      typeof window !== "undefined" && typeof window.matchMedia !== "undefined";
    readMatchers = (entries) =>
      Object.keys(entries).reduce(
        (summary, entryName) => ({ ...summary, [entryName]: entries[entryName].matches }),
        {},
      );
    handleChange = () => {
      const summary = this.readMatchers(this.state.matchers!);
      this.setState({ summary });
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
