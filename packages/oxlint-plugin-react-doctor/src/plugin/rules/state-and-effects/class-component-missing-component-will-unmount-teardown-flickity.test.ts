import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const cases = [
  {
    name: "default-provider-owned-slot-with-no-teardown",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 11,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "awaited-default-constructor-bound-once",
    code: "import React, { Component } from 'react';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  async componentDidMount() {\n    if (!this.container) return;\n    const WidgetConstructor = (await import('flickity')).default;\n    this.widget = new WidgetConstructor(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 11,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "resize-and-watchcss-disabled-still-registry-owned",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, { resize: false, watchCSS: false });\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 11,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "ordinary-optional-options-empty-default",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    const { options = {} } = this.props;\n    this.widget = new Flickity(this.container, options);\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 12,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "conditional-reference-observation-does-not-cover-absent-path",
    code: "import React, { Component } from 'react';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  async componentDidMount() {\n    if (!this.container) return;\n    const WidgetConstructor = (await import('flickity')).default;\n    const { onAcquire, options = {} } = this.props;\n    this.widget = new WidgetConstructor(this.container, options);\n    if (onAcquire) onAcquire(this.widget);\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 12,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "renamed-default-value-import",
    code: "import React, { Component } from 'react';\nimport CarouselProvider from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new CarouselProvider(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 11,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "direct-unmount-destroy-protocol",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n  componentWillUnmount() { this.widget?.destroy(); }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "awaited-construction-with-unmount-and-live-guard",
    code: "import React, { Component } from 'react';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  async componentDidMount() {\n    if (!this.container) return;\n    const WidgetConstructor = (await import('flickity')).default;\n    if (!this.live) return;\n    this.widget = new WidgetConstructor(this.container, {});\n  }\n  live = true;\n  componentWillUnmount() { this.live = false; this.widget?.destroy(); }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "awaited-construction-with-unmount-but-no-live-guard",
    code: "import React, { Component } from 'react';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  async componentDidMount() {\n    if (!this.container) return;\n    const WidgetConstructor = (await import('flickity')).default;\n    this.widget = new WidgetConstructor(this.container, {});\n  }\n  componentWillUnmount() { this.widget?.destroy(); }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unconditional-explicit-reference-transfer",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n    this.props.onAcquire!(this.widget);\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unknown-resource-escape",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nimport { retainWidget } from './owner';\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n    retainWidget(this.widget);\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "same-name-local-constructor",
    code: "import React, { Component } from 'react';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Flickity { constructor(element: unknown, options: unknown) {} }\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "constructor-shadowed-in-mount",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    const Flickity = this.props.onAcquire;\n    if (!this.container || !Flickity) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "default-import-from-another-package",
    code: "import React, { Component } from 'react';\nimport Flickity from 'other-carousel';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "nonliteral-dynamic-provider",
    code: "import React, { Component } from 'react';\n\ninterface GalleryProps { moduleName: string; options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  async componentDidMount() {\n    if (!this.container) return;\n    const WidgetConstructor = (await import(this.props.moduleName)).default;\n    this.widget = new WidgetConstructor(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "type-only-import-used-as-constructor",
    code: "import React, { Component } from 'react';\nimport type Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "mutable-constructor-binding",
    code: "import React, { Component } from 'react';\n\ninterface GalleryProps { replacement: any; options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  async componentDidMount() {\n    if (!this.container) return;\n    let WidgetConstructor = (await import('flickity')).default;\n    WidgetConstructor = this.props.replacement;\n    this.widget = new WidgetConstructor(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "visible-provider-prototype-replacement",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nFlickity.prototype.destroy = () => {};\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "owned-slot-overwritten-by-unknown-value",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n  replaceWidget(widget: unknown) { this.widget = widget; }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "existing-synchronous-destroy",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n    this.widget.destroy();\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "module-eval-provider-contradiction",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\neval('Flickity.prototype.destroy = function() {}');\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unrelated-type-import-reexport-remains-allowed",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nimport type { WidgetMetadata } from './metadata';\nexport type { WidgetMetadata } from './metadata';\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 13,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "deactivate-does-not-release-registry",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n    this.widget.deactivate();\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 11,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "existing-options-ready-destroy-protocol",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, { on: { ready() { this.destroy(); } } });\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "computed-storage-slot-is-opaque",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { slot: string; options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this[this.props.slot] = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "known-vm-loader-module-contradiction",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nimport vm from 'node:vm';\nvm.runInThisContext('globalThis.Flickity = class {}');\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "native-ref-assignment-to-discarding-setter-does-not-prove-fresh-element",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst sharedElement = document.createElement('div');\nconst sharedWidget = new Flickity(sharedElement, {});\nexport const releaseSharedWidget = () => sharedWidget.destroy();\n\nclass Gallery extends Component {\n  widget: any = null;\n  get container() { return sharedElement; }\n  set container(_element: HTMLDivElement | null) {}\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "nested-class-native-ref-does-not-own-outer-element-field",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() {\n    class RefOwner extends Component {\n      container: HTMLDivElement | null = null;\n      render() { return <div ref={element => { this.container = element; }} />; }\n    }\n    return <RefOwner />;\n  }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "ordinary-function-native-ref-does-not-own-enclosing-class-field",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() {\n    const foreignOwner = { container: null };\n    const renderForeign = function(this: { container: HTMLDivElement | null }) {\n      return <div ref={element => { this.container = element; }} />;\n    };\n    return renderForeign.call(foreignOwner);\n  }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "callable-owning-callback-default-removes-absent-callback-path",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst retainAndDispose = (widget: { destroy: () => void }) => {\n  widget.destroy();\n};\ninterface GalleryProps {\n  onAcquire?: (widget: any) => void;\n}\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    const { onAcquire = retainAndDispose } = this.props;\n    this.widget = new Flickity(this.container, {});\n    if (onAcquire) onAcquire(this.widget);\n  }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "nested-class-static-initializer-does-not-acquire-for-outer-class",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst sharedElement = document.createElement('div');\nconst sharedWidget = new Flickity(sharedElement, {});\nexport const releaseSharedWidget = () => sharedWidget.destroy();\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    class NestedAllocation {\n      static container = sharedElement;\n      static widget: any = null;\n      static borrowed = (this.widget = new Flickity(this.container, {}));\n    }\n    void NestedAllocation;\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "module-level-native-ready-handler-destroys-before-unmount",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nfunction releaseOnReady(this: { destroy: () => void }) { this.destroy(); }\nclass Gallery extends Component {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, { on: { ready: releaseOnReady } });\n  }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "react-static-default-props-force-callable-handoff",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst retainAndDispose = (widget: { destroy: () => void }) => widget.destroy();\ninterface GalleryProps { onAcquire?: (widget: any) => void; }\nclass Gallery extends Component<GalleryProps> {\n  static defaultProps = { onAcquire: retainAndDispose };\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    const { onAcquire } = this.props;\n    this.widget = new Flickity(this.container, {});\n    if (onAcquire) onAcquire(this.widget);\n  }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "direct-props-write-forces-owning-callback",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst retainAndDispose = (widget: { destroy: () => void }) => widget.destroy();\ninterface GalleryProps { onAcquire?: (widget: any) => void; }\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.props.onAcquire = retainAndDispose;\n    const { onAcquire } = this.props;\n    this.widget = new Flickity(this.container, {});\n    if (onAcquire) onAcquire(this.widget);\n  }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "inherited-component-unmount-destroys-owned-slot",
    code: "import React from 'react';\nimport Flickity from 'flickity';\n\nclass Component extends React.Component {\n  widget: any;\n  componentWillUnmount() { this.widget?.destroy(); }\n}\nclass Gallery extends Component {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "window-object-define-property-replaces-native-ref-provider",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst sharedElement = document.createElement('div');\nconst sharedWidget = new Flickity(sharedElement, {});\nexport const releaseSharedWidget = () => sharedWidget.destroy();\nwindow.Object.defineProperty(React, 'createElement', {\n  value(_tag: string, properties: { ref: (element: HTMLDivElement) => void }) {\n    properties.ref(sharedElement);\n    return null;\n  },\n});\nclass Gallery extends Component {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n  render() {\n    return React.createElement('div', { ref: element => { this.container = element; } });\n  }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "native-ref-extra-ownership-call-does-not-prove-fresh-class-acquisition",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst ownedWidgets: Flickity[] = [];\nconst registerElsewhere = (element: HTMLDivElement | null) => {\n  if (element) ownedWidgets.push(new Flickity(element, {}));\n};\nexport const releaseElsewhere = () => ownedWidgets.forEach(widget => widget.destroy());\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { registerElsewhere(element); this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "duplicate-jsx-ref-overrides-selected-native-writer",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nclass Gallery extends Component {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n  render() {\n    return <div ref={element => { this.container = element; }} ref={() => {}} />;\n  }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "computed-create-element-prop-overrides-selected-ref",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nclass Gallery extends Component {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n  render() {\n    const referenceKey = 'ref';\n    return React.createElement('div', {\n      ref: element => { this.container = element; },\n      [referenceKey]: () => {},\n    });\n  }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "static-custom-element-type-default-is-not-native-dom",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst Forwarder = () => null;\ninterface GalleryProps { elementType?: React.ElementType; }\nclass Gallery extends Component<GalleryProps> {\n  static defaultProps = { elementType: Forwarder };\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n  render() {\n    const { elementType = 'div' } = this.props;\n    return React.createElement(elementType, { ref: element => { this.container = element; } });\n  }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "dom-slot-passed-to-separate-owner-before-construction",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst ownedElsewhere = new Map<HTMLElement, Flickity>();\nconst registerElsewhere = (element: HTMLElement) => {\n  ownedElsewhere.set(element, new Flickity(element, {}));\n};\nexport const releaseElsewhere = () => {\n  ownedElsewhere.forEach(widget => widget.destroy());\n  ownedElsewhere.clear();\n};\nclass Gallery extends Component {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    registerElsewhere(this.container);\n    this.widget = new Flickity(this.container, {});\n  }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "computed-static-default-props-force-callable-handoff",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst retainAndDispose = (widget: { destroy: () => void }) => widget.destroy();\ninterface GalleryProps { onAcquire?: (widget: any) => void; }\nclass Gallery extends Component<GalleryProps> {\n  static ['defaultProps'] = { onAcquire: retainAndDispose };\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    const { onAcquire } = this.props;\n    this.widget = new Flickity(this.container, {});\n    if (onAcquire) onAcquire(this.widget);\n  }\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "captured-foreign-this-props-are-not-selected-class-optional-callback",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst disposeWidget = (widget: { destroy: () => void }) => widget.destroy();\nfunction buildGallery(this: { props: { onAcquire: (widget: any) => void } }) {\n  const { onAcquire } = this.props;\n  return class Gallery extends Component {\n    container: HTMLDivElement | null = null;\n    widget: any = null;\n    componentDidMount() {\n      if (!this.container) return;\n      this.widget = new Flickity(this.container, {});\n      if (onAcquire) onAcquire(this.widget);\n    }\n    render() { return <div ref={element => { this.container = element; }} />; }\n  };\n}\nexport default buildGallery.call({ props: { onAcquire: disposeWidget } });\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "class-decorator-installs-inherited-owned-teardown",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nfunction ownsTeardown(Base: any) {\n  return class extends Base {\n    componentWillUnmount() { this.widget?.destroy(); }\n  };\n}\n\n@ownsTeardown\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "image-observer-callback-invokes-source-visible-registry-disposal",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\nimport imagesloaded from 'imagesloaded';\n\nconst releaseById = () => {\n  const element = document.querySelector('#owned');\n  if (element) new Flickity(element, {}).destroy();\n};\nclass Gallery extends Component {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n    imagesloaded(this.container, () => releaseById());\n  }\n  render() { return <div id=\"owned\" ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "direct-local-helper-invokes-source-visible-registry-disposal",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst releaseById = () => {\n  const element = document.querySelector('#owned');\n  if (element) new Flickity(element, {}).destroy();\n};\nclass Gallery extends Component {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n    releaseById();\n  }\n  render() { return <div id=\"owned\" ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unused-native-host-ref-never-mounts",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() {\n    const unusedHost = <div ref={element => { this.container = element; }} />;\n    return null;\n  }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "own-render-field-does-not-prove-native-ref",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render = () => <div ref={element => { this.container = element; }} />;\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "native-create-element-defaults-and-image-observer-dom-roles",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\nimport imagesloaded from 'imagesloaded';\n\ninterface GalleryProps { elementType?: React.ElementType; options?: object; }\ninterface GalleryState { ready: boolean; }\nclass Gallery extends Component<GalleryProps, GalleryState> {\n  static defaultProps = { elementType: 'section', options: {} };\n  container: HTMLElement | null = null;\n  widget: any = null;\n  state = { ready: false };\n\n  componentDidMount() {\n    if (!this.container) return;\n    const { options = {} } = this.props;\n    this.widget = new Flickity(this.container, options);\n    const markReady = () => this.setState({ ready: true });\n    imagesloaded(this.container, markReady);\n    imagesloaded(this.container, () => this.widget?.reloadCells());\n  }\n\n  render() {\n    const { elementType = 'section' } = this.props;\n    let hasMarker = false;\n    if (this.container) {\n      hasMarker = Boolean(this.container.querySelector('.gallery-marker'));\n    }\n    return React.createElement(elementType, {\n      className: hasMarker ? 'marked' : 'unmarked',\n      ref: (element: HTMLElement | null) => { this.container = element; },\n    }, this.state.ready ? 'Ready' : 'Loading');\n  }\n}\nexport default Gallery;\n",
    options: {
      filename: "synthetic-gallery.tsx",
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expectedResult: {
      diagnostics: [
        {
          column: 18,
          line: 16,
          message:
            "This class creates a Flickity instance that can remain registered after unmount. Add an owned destroy() disposal path; asynchronous setup also needs to avoid acquiring after unmount.",
          nodeType: "NewExpression",
        },
      ],
      parseErrors: [],
    },
  },
];

describe("Flickity constructor registry ownership", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(
        classComponentMissingComponentWillUnmountTeardown,
        testCase.code,
        testCase.options,
      );
      expect(result).toEqual(testCase.expectedResult);
    });
  }
});
