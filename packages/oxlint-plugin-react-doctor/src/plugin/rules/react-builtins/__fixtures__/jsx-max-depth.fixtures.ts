// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_max_depth.rs`
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
    code: `
			        <App />
			      `,
  },
  {
    code: `
			        <App>
			          <foo />
			        </App>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        <App>
			          <foo>
			            <bar />
			          </foo>
			        </App>
			      `,
  },
  {
    code: `
			        <App>
			          <foo>
			            <bar />
			          </foo>
			        </App>
			      `,
    oxcOptions: [{ max: 2 }],
  },
  {
    code: `
			        const x = <div><em>x</em></div>;
			        <div>{x}</div>
			      `,
    oxcOptions: [{ max: 2 }],
  },
  { code: `const foo = (x) => <div><em>{x}</em></div>;`, oxcOptions: [{ max: 2 }] },
  {
    code: `
			        <></>
			      `,
  },
  {
    code: `
			        <>
			          <foo />
			        </>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        const x = <><em>x</em></>;
			        <>{x}</>
			      `,
    oxcOptions: [{ max: 2 }],
  },
  {
    code: `
			        const x = (
			          <tr>
			            <td>1</td>
			            <td>2</td>
			          </tr>
			        );
			        <tbody>
			          {x}
			        </tbody>
			      `,
    oxcOptions: [{ max: 2 }],
  },
  {
    code: `
			        const Example = props => {
			          for (let i = 0; i < length; i++) {
			            return <Text key={i} />;
			          }
			        };
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        export function MyComponent() {
			          const A = <React.Fragment>{<div />}</React.Fragment>;
			          return <div>{A}</div>;
			        }
			      `,
  },
  {
    code: `
			        function Component() {
			          let first = "";
			          const second = first;
			          first = second;
			          return <div id={first} />;
			        };
			      `,
  },
  {
    code: `
			        function Component() {
			          let first = "";
			          let second = "";
			          let third = "";
			          let fourth = "";
			          const fifth = first;
			          first = second;
			          second = third;
			          third = fourth;
			          fourth = fifth;
			          return <div id={first} />;
			        };
			      `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
			        <App>
			          <foo />
			        </App>
			      `,
    oxcOptions: [{ max: 0 }],
  },
  {
    code: `
			        <App>
			          <foo>{bar}</foo>
			        </App>
			      `,
    oxcOptions: [{ max: 0 }],
  },
  {
    code: `
			        <App>
			          <foo>
			            <bar />
			          </foo>
			        </App>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        const x = <div><span /></div>;
			        <div>{x}</div>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        const x = <div><span /></div>;
			        let y = x;
			        <div>{y}</div>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        const x = <div><span /></div>;
			        let y = x;
			        <div>{x}-{y}</div>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        <div>
			        {<div><div><span /></div></div>}
			        </div>
			      `,
  },
  {
    code: `
			        <>
			          <foo />
			        </>
			      `,
    oxcOptions: [{ max: 0 }],
  },
  {
    code: `
			        <>
			          <>
			            <bar />
			          </>
			        </>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        const x = <><span /></>;
			        let y = x;
			        <>{x}-{y}</>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        const x = (
			          <tr>
			            <td>1</td>
			            <td>2</td>
			          </tr>
			        );
			        <tbody>
			          {x}
			        </tbody>
			      `,
    oxcOptions: [{ max: 1 }],
  },
  {
    code: `
			        <div className="custom_modal">
			          <Modal className={classes.modal} open={isOpen} closeAfterTransition>
			            <Fade in={isOpen}>
			              <DialogContent>
			                <Icon icon="cancel" onClick={onClose} popoverText="Close Modal" />
			                <div className="modal_content">{children}</div>
			                <div className={clxs('modal_buttons', classes.buttons)}>
			                  <Button className="modal_buttons--cancel" onClick={onCancel}>
			                    {cancelMsg ? cancelMsg : 'Cancel'}
			                  </Button>
			                </div>
			              </DialogContent>
			            </Fade>
			          </Modal>
			        </div>
			      `,
    oxcOptions: [{ max: 4 }],
  },
];
