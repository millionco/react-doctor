import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const cases = [
  {
    name: "stable-paired-owned-record",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [],
  },
  {
    name: "missing-collection-cleanup",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      void this.state.matchers;\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "wrong-cleanup-callback-identity",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(() => handleChange());\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "same-record-domain-shrinks",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      delete this.state.matchers.compact;\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "alpha-renamed-iteration-and-static-handler-alias",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange: preservedHandler } = this;\n        Object.values(this.state.matchers).forEach((listenerTarget) => {\n          listenerTarget.addListener(preservedHandler);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange: preservedHandler } = this;\n        Object.values(this.state.matchers).forEach((listenerTarget) => {\n          listenerTarget.removeListener(preservedHandler);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [],
  },
  {
    name: "optional-native-record-readonly-projection-and-disjoint-update",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      let nativeEntries = undefined;\n      let summary = {};\n      if (this.supportsQueries()) {\n        nativeEntries = this.setupMatchers(props.queries);\n        summary = this.readMatchers(nativeEntries);\n      }\n      this.state = { matchers: nativeEntries, summary, changeCount: 0 };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    supportsQueries = () =>\n      typeof window !== "undefined" && typeof window.matchMedia !== "undefined";\n    readMatchers = (entries) =>\n      Object.keys(entries).reduce(\n        (summary, entryName) => ({ ...summary, [entryName]: entries[entryName].matches }),\n        {},\n      );\n    handleChange = () => {\n      const summary = this.readMatchers(this.state.matchers!);\n      this.setState({ summary });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [],
  },
  {
    name: "entry-replacement",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.state.matchers.compact = window.matchMedia("(min-width: 1px)");\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "escaped-record-alias",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      const escaped = this.state.matchers; escaped.compact = window.matchMedia("(min-width: 1px)");\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "selected-key-set-state",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ matchers: {} });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "whole-state-reset",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.state = { matchers: {} };\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "functional-state-updater",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState(() => ({ changeCount: 1 }));\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "spread-state-updater",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ ...this.state, changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "computed-state-updater",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ ["changeCount"]: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-replacement",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.handleChange = () => {};\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-deletion",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      delete this.handleChange;\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "filtered-cleanup-domain",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).filter(Boolean).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "unreachable-cleanup-operation",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          return; matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "async-cleanup-operation",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach(async (matcher) => {\n          await Promise.resolve(); matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "throwing-cleanup-prelude",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          throw Error("not removed"); matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "separate-bound-cleanup-function",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange.bind(this));\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "default-handler-destructure",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange = () => {} } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "factory-not-native",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: createFakeMatcher(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "mutated-array-prototype",
    code: 'Array.prototype.forEach = () => {};\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "reflective-provider-write",
    code: 'Object.defineProperty(window, "matchMedia", { value: () => ({ addListener() {}, removeListener() {} }) });\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "destructured-object-provider",
    code: 'const { values: collectValues } = Object;\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "fake-global-provider",
    code: 'const window = { matchMedia: () => ({ addListener() {}, removeListener() {} }) };\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "external-selected-handler-write",
    code: 'const foreignInstance = {}; foreignInstance.handleChange = () => {};\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "runtime-enum-provider-mutation",
    code: 'enum ProviderContradiction { Value = (Object.values = (() => []) as any) as any }\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "runtime-enum-selected-record-write",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      enum DomainContradiction { Value = (delete this.state.matchers.compact) as any }\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "different-cleanup-handler-property",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    otherHandler = () => {};\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { otherHandler: handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "inherited-react-set-state-replaces-selected-record",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n  reset?: boolean;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    componentWillReceiveProps(nextProps: ListenerProps) {\n      if (nextProps.reset) super.setState({ matchers: {} });\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "global-function-constructor-provider-write",
    code: 'Function("const values=Object.values;let phase=0;Object.values=record=>phase++?[]:values(record)")();\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "function-constructor-property-provider-write",
    code: '(() => {}).constructor("const values=Object.values;let phase=0;Object.values=record=>phase++?[]:values(record)")();\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "source-visible-external-instance-set-state-replaces-domain",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n\nconst mountedInstances = [];\nconst { Provider } = createListenerComponents();\nexport const sampleView = (\n  <Provider\n    queries={{ compact: "(min-width: 1px)" }}\n    ref={(instance) => {\n      if (instance) mountedInstances.push(instance);\n    }}\n  />\n);\nexport const resetMountedCollections = () => {\n  mountedInstances.forEach((instance) => instance.setState({ matchers: {} }));\n};\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "source-visible-external-instance-destructured-record-alias-mutates-domain",
    code: 'import React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n\nconst mountedInstances = [];\nconst { Provider } = createListenerComponents();\nexport const sampleView = (\n  <Provider\n    queries={{ compact: "(min-width: 1px)" }}\n    ref={(instance) => {\n      if (instance) mountedInstances.push(instance);\n    }}\n  />\n);\nexport const resetMountedCollections = () => {\n  mountedInstances.forEach((instance) => {\n    const { state } = instance;\n    const { matchers } = state;\n    delete matchers.compact;\n  });\n};\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 29,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "global-string-timer-can-replace-native-iterator",
    code: 'setTimeout("Object.values = () => []", 1);\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "dom-script-native-provider-replacement",
    code: 'const injectedScript = document.createElement("script");\ninjectedScript.textContent = "const values = Object.values; let phase = 0; Object.values = record => phase++ ? [] : values(record)";\ndocument.head.appendChild(injectedScript);\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 32,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "dynamic-import-provider-capability",
    code: 'void import("data:text/javascript,Object.values%20%3D%20()%20%3D%3E%20%5B%5D");\nimport React from "react";\ninterface ListenerProps {\n  queries: Record<string, string>;\n}\nexport const createListenerComponents = () => ({\n  Provider: class ListenerProvider extends React.Component<ListenerProps> {\n    constructor(props: ListenerProps) {\n      super(props);\n      this.state = {\n        matchers: this.setupMatchers(props.queries),\n        changeCount: 0,\n      };\n    }\n    setupMatchers = (queries: Record<string, string>) =>\n      Object.keys(queries).reduce(\n        (matchers, queryKey) => ({\n          ...matchers,\n          [queryKey]: window.matchMedia(queries[queryKey]),\n        }),\n        {},\n      );\n    handleChange = () => {\n      this.setState({ changeCount: 1 });\n    };\n    componentDidMount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.addListener(handleChange);\n        });\n      }\n    }\n    componentWillUnmount() {\n      if (this.state.matchers) {\n        const { handleChange } = this;\n        Object.values(this.state.matchers).forEach((matcher) => {\n          matcher.removeListener(handleChange);\n        });\n      }\n    }\n    render() {\n      return null;\n    }\n  },\n});\n',
    expectedDiagnostics: [
      {
        column: 10,
        line: 30,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("class-component-missing-component-will-unmount-teardown stable collections", () => {
  it.each(cases)("$name", ({ code, expectedDiagnostics }) => {
    const actual = runRule(classComponentMissingComponentWillUnmountTeardown, code, {
      filename: "synthetic-stable-matcher-collection.tsx",
      includeLocations: true,
    });
    expect(actual.parseErrors).toEqual([]);
    expect(actual.diagnostics).toEqual(expectedDiagnostics);
  });
});
