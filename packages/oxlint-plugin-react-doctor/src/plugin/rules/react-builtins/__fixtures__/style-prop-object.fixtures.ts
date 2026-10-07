// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/style_prop_object.rs`
// Each entry is a verbatim port of an OXC `pass`/`fail` vec entry.
// `oxcOptions` (optional) is OXC's first config arg (`Some(json!([…]))`),
// preserved as JS for tests that want to translate it. `oxcSettings`
// (optional) mirrors the third tuple slot used for plugin settings.

export interface OxcFixture {
  code: string;
  oxcOptions?: unknown;
  oxcSettings?: unknown;
  oxcFilename?: string;
}

export const passCases: ReadonlyArray<OxcFixture> = [
  { code: `<div style={{ color: "blue" }} />` },
  { code: `<div style={{ color: "ASD" }} />` },
  { code: `<Hello style={{ color: "red" }} />` },
  {
    code: `
              function redDiv() {
                const styles = { color: "red" };
                return <div style={styles} />;
              }
            `,
  },
  {
    code: `
              function redDiv() {
                const styles = { color: "red" };
                return <Hello style={styles} />;
              }
            `,
  },
  {
    code: `
              const styles = { color: "red" };
              function redDiv() {
                return <div style={styles} />;
              }
            `,
  },
  {
    code: `
              function redDiv(props) {
                return <div style={props.styles} />;
              }
            `,
  },
  {
    code: `
              import styles from './styles';
              function redDiv() {
                return <div style={styles} />;
              }
            `,
  },
  {
    code: `
              import mystyles from './styles';
              const styles = Object.assign({ color: 'red' }, mystyles);
              function redDiv() {
                return <div style={styles} />;
              }
            `,
  },
  {
    code: `
              const otherProps = { style: { color: "red" } };
              const { a, b, ...props } = otherProps;
              <div {...props} />
            `,
  },
  {
    code: `
              const styles = Object.assign({ color: 'red' }, mystyles);
              React.createElement("div", { style: styles });
            `,
  },
  { code: `<div style></div>` },
  {
    code: `
              React.createElement(MyCustomElem, {
                [style]: true
              }, 'My custom Elem')
            `,
  },
  {
    code: `
              let style;
              <div style={style}></div>
            `,
  },
  {
    code: `
              let style = null;
              <div style={style}></div>
            `,
  },
  {
    code: `
              let style = undefined;
              <div style={style}></div>
            `,
  },
  {
    code: `
              const otherProps = { style: undefined };
              const { a, b, ...props } = otherProps;
              <div {...props} />
            `,
  },
  {
    code: `
              React.createElement("div", {
                style: undefined
              })
            `,
  },
  {
    code: `
              let style;
              React.createElement("div", {
                style
              })
            `,
  },
  { code: `<div style={null}></div>` },
  {
    code: `
              const props = { style: null };
              <div {...props} />
            `,
  },
  {
    code: `
              const otherProps = { style: null };
              const { a, b, ...props } = otherProps;
              <div {...props} />
            `,
  },
  {
    code: `
              React.createElement("div", {
                style: null
              })
            `,
  },
  {
    code: `
              const MyComponent = (props) => {
                React.createElement(MyCustomElem, {
                  ...props
                });
              };
            `,
  },
  { code: `<MyComponent style="myStyle" />`, oxcOptions: [{ allow: ["MyComponent"] }] },
  {
    code: `React.createElement(BazQuxComponent, { style: "mySpecialStyle" })`,
    oxcOptions: [{ allow: ["MyComponent", "FooBarComponent", "BazQuxComponent", "AbcComponent"] }],
  },
  {
    code: `React.createElement(MyComponent, { style: "mySpecialStyle" })`,
    oxcOptions: [{ allow: ["MyComponent"] }],
  },
  {
    code: `
            let styles: object | undefined
            return <div style={styles} />
          `,
  },
  {
    code: `
            let styles: CSSProperties | undefined
            return <div style={styles} />
          `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div style="color: 'red'" />` },
  { code: `<Hello style="color: 'green'" />` },
  { code: `<div style={true} />` },
  {
    code: `
              const styles = \`color: "red"\`;
              function redDiv2() {
                return <div style={styles} />;
              }
            `,
  },
  {
    code: `
              const styles = 'color: "red"';
              function redDiv2() {
                return <div style={styles} />;
              }
            `,
  },
  {
    code: `
              const styles = 'color: "blue"';
              function redDiv2() {
                return <Hello style={styles} />;
              }
            `,
  },
  {
    code: `
              const styles = true;
              function redDiv() {
                return <div style={styles} />;
              }
            `,
  },
  { code: `<MyComponent style="myStyle" />`, oxcOptions: [{ allow: ["MyOtherComponent"] }] },
  {
    code: `React.createElement(MyComponent2, { style: "mySpecialStyle" })`,
    oxcOptions: [{ allow: ["MyOtherComponent"] }],
  },
  {
    code: `
            let styles: string | undefined
            return <div style={styles} />
          `,
  },
  {
    code: `
            let styles: number | undefined
            return <div style={styles} />
          `,
  },
  {
    code: `
            let styles: boolean | undefined
            return <div style={styles} />
          `,
  },
];
