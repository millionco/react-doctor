// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_array_index_key.rs`
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
  {
    code: `things.map((thing) => (
            <Hello key={thing.id} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: thing.id })
          ));
        `,
  },
  {
    code: `things.forEach((thing, index) => {
            otherThings.push(<Hello key={thing.id} />);
          });
        `,
  },
  {
    code: `things.filter((thing, index) => {
            otherThings.push(<Hello key={thing.id} />);
          });
        `,
  },
  {
    code: `things.some((thing, index) => {
            otherThings.push(<Hello key={thing.id} />);
          });
        `,
  },
  {
    code: `things.every((thing, index) => {
            otherThings.push(<Hello key={thing.id} />);
          });
        `,
  },
  {
    code: `things.find((thing, index) => {
            otherThings.push(<Hello key={thing.id} />);
          });
        `,
  },
  {
    code: `things.findIndex((thing, index) => {
            otherThings.push(<Hello key={thing.id} />);
          });
        `,
  },
  {
    code: `things.flatMap((thing, index) => (
            <Hello key={thing.id} />
          ));
        `,
  },
  {
    code: `things.reduce((collection, thing, index) => (
            collection.concat(<Hello key={thing.id} />)
          ), []);
        `,
  },
  {
    code: `things.reduceRight((collection, thing, index) => (
            collection.concat(<Hello key={thing.id} />)
          ), []);
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: getKey(thing.id, index) })
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: \`\${thing.type + index}\` })
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            <Hello key={\`abc\${String(index)}\`} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: \`abc\${index.toString()}\` })
          ));
        `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `things.map((thing, index) => (
            <Hello key={index} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            <Hello key={\`abc\${index}\`} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            <Hello key={1 + index} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            <Hello thing={thing} key={index} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            <Hello key={thing.id} key={index} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: index })
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: thing.id, key: index })
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, {
              key: index
            })
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: \`abc\${index}\` })
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: 1 + index })
          ));
        `,
  },
  {
    code: `things.forEach((thing, index) => {
            otherThings.push(<Hello key={index} />);
          });
        `,
  },
  {
    code: `things.filter((thing, index) => {
            otherThings.push(<Hello key={index} />);
          });
        `,
  },
  {
    code: `things.some((thing, index) => {
            otherThings.push(<Hello key={index} />);
          });
        `,
  },
  {
    code: `things.every((thing, index) => {
            otherThings.push(<Hello key={index} />);
          });
        `,
  },
  {
    code: `things.find((thing, index) => {
            otherThings.push(<Hello key={index} />);
          });
        `,
  },
  {
    code: `things.findIndex((thing, index) => {
            otherThings.push(<Hello key={index} />);
          });
        `,
  },
  {
    code: `things.flatMap((thing, index) => (
            <Hello key={index} />
          ));
        `,
  },
  {
    code: `things.reduce((collection, thing, index) => (
            collection.concat(<Hello key={index} />)
          ), []);
        `,
  },
  {
    code: `things.reduceRight((collection, thing, index) => (
            collection.concat(<Hello key={index} />)
          ), []);
        `,
  },
  {
    code: `things.map((thing, index) => (
            <Hello key={index.toString()} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            <Hello key={String(index)} />
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: index.toString() })
          ));
        `,
  },
  {
    code: `things.map((thing, index) => (
            React.cloneElement(thing, { key: String(index) })
          ));
        `,
  },
];
