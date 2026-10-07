// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_handler_names.rs`
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
  { code: `<TestComponent onChange={this.handleChange} />` },
  { code: `<TestComponent onChange={this.handle123Change} />` },
  { code: `<TestComponent onChange={this.props.handleChange} />` },
  { code: `<TestComponent onChange={this.props.onChange} />` },
  {
    code: `
			        <TestComponent
			          onChange={
			            this
			              .handleChange
			          } />
			      `,
  },
  {
    code: `
			        <TestComponent
			          onChange={
			            this
			              .props
			              .handleChange
			          } />
			      `,
  },
  {
    code: `<TestComponent onChange={handleChange} />`,
    oxcOptions: [{ checkLocalVariables: true }],
  },
  {
    code: `<TestComponent onChange={takeCareOfChange} />`,
    oxcOptions: [{ checkLocalVariables: false }],
  },
  {
    code: `<TestComponent onChange={event => window.alert(event.target.value)} />`,
    oxcOptions: [{ checkInlineFunction: false }],
  },
  {
    code: `<TestComponent onChange={() => handleChange()} />`,
    oxcOptions: [{ checkInlineFunction: true, checkLocalVariables: true }],
  },
  {
    code: `<TestComponent onChange={() => { handleChange() }} />`,
    oxcOptions: [{ checkInlineFunction: true, checkLocalVariables: false }],
  },
  {
    code: `<TestComponent onChange={() => this.handleChange()} />`,
    oxcOptions: [{ checkInlineFunction: true }],
  },
  { code: `<TestComponent onChange={() => 42} />` },
  { code: `<TestComponent onChange={this.props.onFoo} />` },
  { code: `<TestComponent isSelected={this.props.isSelected} />` },
  { code: `<TestComponent shouldDisplay={this.state.shouldDisplay} />` },
  { code: `<TestComponent shouldDisplay={arr[0].prop} />` },
  { code: `<TestComponent onChange={props.onChange} />` },
  { code: `<TestComponent ref={this.handleRef} />` },
  { code: `<TestComponent ref={this.somethingRef} />` },
  {
    code: `<TestComponent test={this.props.content} />`,
    oxcOptions: [{ eventHandlerPrefix: "on", eventHandlerPropPrefix: "on" }],
  },
  { code: `<TestComponent only={this.only} />` },
  {
    code: `<TestComponent onChange={this.someChange} />`,
    oxcOptions: [{ eventHandlerPrefix: false, eventHandlerPropPrefix: "on" }],
  },
  {
    code: `<TestComponent somePrefixChange={this.someChange} />`,
    oxcOptions: [{ eventHandlerPrefix: false, eventHandlerPropPrefix: "somePrefix" }],
  },
  {
    code: `<TestComponent someProp={this.handleChange} />`,
    oxcOptions: [{ eventHandlerPropPrefix: false }],
  },
  {
    code: `<TestComponent someProp={this.somePrefixChange} />`,
    oxcOptions: [{ eventHandlerPrefix: "somePrefix", eventHandlerPropPrefix: false }],
  },
  {
    code: `<TestComponent someProp={props.onChange} />`,
    oxcOptions: [{ eventHandlerPropPrefix: false }],
  },
  {
    code: `<TestComponent onChange={handleChange} />`,
    oxcOptions: [{ eventHandlerPrefix: "handle|on" }],
  },
  {
    code: `<TestComponent onChange={onChange} />`,
    oxcOptions: [{ eventHandlerPrefix: "handle|on" }],
  },
  {
    code: `<TestComponent somePrefixChange={handleChange} />`,
    oxcOptions: [{ eventHandlerPropPrefix: "somePrefix|on" }],
  },
  {
    code: `<TestComponent onChange={handleChange} />`,
    oxcOptions: [{ eventHandlerPropPrefix: "somePrefix|on" }],
  },
  {
    code: `<ComponentFromOtherLibraryBar customPropNameBar={handleSomething} />;`,
    oxcOptions: [
      { checkLocalVariables: true, ignoreComponentNames: ["ComponentFromOtherLibraryBar"] },
    ],
  },
  {
    code: `
            function App() {
              return (
                <div>
                  <MyLibInput customPropNameBar={handleSomething} />;
                  <MyLibCheckbox customPropNameBar={handleSomething} />;
                  <MyLibButton customPropNameBar={handleSomething} />;
                </div>
              )
            }
            `,
    oxcOptions: [{ checkLocalVariables: true, ignoreComponentNames: ["MyLib*"] }],
  },
  { code: `<TestComponent onChange={true} />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<TestComponent onChange={this.doSomethingOnChange} />` },
  { code: `<TestComponent onChange={this.handlerChange} />` },
  { code: `<TestComponent onChange={this.handle} />` },
  { code: `<TestComponent onChange={this.handle2} />` },
  { code: `<TestComponent onChange={this.handl3Change} />` },
  { code: `<TestComponent onChange={this.handle4change} />` },
  { code: `<TestComponent onChange={this.props.doSomethingOnChange} />` },
  { code: `<TestComponent onChange={this.props.obj.onChange} />` },
  { code: `<TestComponent onChange={props.obj.onChange} />` },
  {
    code: `<TestComponent onChange={takeCareOfChange} />`,
    oxcOptions: [{ checkLocalVariables: true }],
  },
  {
    code: `<TestComponent onChange={() => this.takeCareOfChange()} />`,
    oxcOptions: [{ checkInlineFunction: true }],
  },
  { code: `<TestComponent only={this.handleChange} />` },
  { code: `<TestComponent2 only={this.handleChange} />` },
  { code: `<TestComponent handleChange={this.handleChange} />` },
  {
    code: `<TestComponent whenChange={handleChange} />`,
    oxcOptions: [{ checkLocalVariables: true }],
  },
  {
    code: `<TestComponent whenChange={() => handleChange()} />`,
    oxcOptions: [{ checkInlineFunction: true, checkLocalVariables: true }],
  },
  {
    code: `<TestComponent onChange={() => { handleChange() }} />`,
    oxcOptions: [{ checkInlineFunction: true, checkLocalVariables: true }],
  },
  {
    code: `<TestComponent onChange={handleChange} />`,
    oxcOptions: [
      { checkLocalVariables: true, eventHandlerPrefix: "handle", eventHandlerPropPrefix: "when" },
    ],
  },
  {
    code: `<TestComponent onChange={() => handleChange()} />`,
    oxcOptions: [
      {
        checkInlineFunction: true,
        checkLocalVariables: true,
        eventHandlerPrefix: "handle",
        eventHandlerPropPrefix: "when",
      },
    ],
  },
  {
    code: `<TestComponent onChange={handleChange} />`,
    oxcOptions: [
      { checkLocalVariables: true, eventHandlerPrefix: "when|on", eventHandlerPropPrefix: "on" },
    ],
  },
  {
    code: `<TestComponent somePrefixChange={handleChange} />`,
    oxcOptions: [
      {
        checkLocalVariables: true,
        eventHandlerPrefix: "handle",
        eventHandlerPropPrefix: "when|on",
      },
    ],
  },
  { code: `<TestComponent onChange={this.onChange} />` },
  {
    code: `
            function App() {
              return (
                <div>
                  <MyLibInput customPropNameBar={handleInput} />;
                  <MyLibCheckbox customPropNameBar={handleCheckbox} />;
                  <MyLibButton customPropNameBar={handleButton} />;
                </div>
              )
            }
            `,
    oxcOptions: [{ checkLocalVariables: true, ignoreComponentNames: ["MyLibrary*"] }],
  },
  { code: `<TestComponent onChange={true} />`, oxcOptions: [{ checkLocalVariables: true }] },
  { code: `<TestComponent onChange={'value'} />`, oxcOptions: [{ checkLocalVariables: true }] },
];
