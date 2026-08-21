// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/button_has_type.rs`
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
  { code: `<span/>` },
  { code: `<span type="foo"/>` },
  { code: `<button type="button"/>` },
  { code: `<button type="submit"/>` },
  { code: `<button type="reset"/>` },
  { code: `<button type={"button"}/>` },
  { code: `<button type={'button'}/>` },
  { code: `<button type={\`button\`}/>` },
  { code: `<button type={condition ? "button" : "submit"}/>` },
  { code: `<button type={condition ? 'button' : 'submit'}/>` },
  { code: `<button type={condition ? \`button\` : \`submit\`}/>` },
  { code: `<button type="button"/>`, oxcOptions: [{ reset: false }] },
  { code: `createElement("span")` },
  { code: `React.createElement("span")` },
  { code: `React.createElement("span", {type: "foo"})` },
  { code: `React.createElement("button", {type: "button"})` },
  { code: `React.createElement("button", {type: 'button'})` },
  { code: `React.createElement("button", {type: \`button\`})` },
  { code: `React.createElement("button", {type: "submit"})` },
  { code: `React.createElement("button", {type: 'submit'})` },
  { code: `React.createElement("button", {type: \`submit\`})` },
  { code: `React.createElement("button", {type: "reset"})` },
  { code: `React.createElement("button", {type: 'reset'})` },
  { code: `React.createElement("button", {type: \`reset\`})` },
  { code: `React.createElement("button", {type: condition ? "button" : "submit"})` },
  { code: `React.createElement("button", {type: condition ? 'button' : 'submit'})` },
  { code: `React.createElement("button", {type: condition ? \`button\` : \`submit\`})` },
  { code: `React.createElement("button", {type: "button"})`, oxcOptions: [{ reset: false }] },
  {
    code: `React.createElement("button", {type: "button"})`,
    oxcOptions: [{ reset: false, submit: false }],
  },
  {
    code: `
			        function MyComponent(): ReactElement {
			          const buttonProps: (Required<Attributes> & ButtonHTMLAttributes<HTMLButtonElement>)[] = [
			            {
			              children: 'test',
			              key: 'test',
			              onClick: (): void => {
			                return;
			              },
			            },
			          ];

			          return <>
			            {
			              buttonProps.map(
			                ({ key, ...props }: Required<Attributes> & ButtonHTMLAttributes<HTMLButtonElement>): ReactElement =>
			                  <button key={key} type="button" {...props} />
			              )
			            }
			          </>;
			        }
			      `,
  },
  { code: `document["createElement"]("button");` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<button/>` },
  { code: `<button type="foo"/>` },
  { code: `<button type={foo}/>` },
  { code: `<button type={"foo"}/>` },
  { code: `<button type={'foo'}/>` },
  { code: `<button type={\`foo\`}/>` },
  { code: `<button type={\`button\${foo}\`}/>` },
  { code: `<button type="reset"/>`, oxcOptions: [{ reset: false }] },
  { code: `<button type={condition ? "button" : foo}/>` },
  { code: `<button type={condition ? "button" : "foo"}/>` },
  { code: `<button type={condition ? "button" : "reset"}/>`, oxcOptions: [{ reset: false }] },
  { code: `<button type={condition ? foo : "button"}/>` },
  { code: `<button type={condition ? "foo" : "button"}/>` },
  { code: `button type/>` },
  { code: `<button type={condition ? "reset" : "button"}/>`, oxcOptions: [{ reset: false }] },
  { code: `createElement("button")` },
  { code: `React.createElement("button")` },
  { code: `React.createElement("button", {type: foo})` },
  { code: `React.createElement("button", {type: "foo"})` },
  { code: `React.createElement("button", {type: "reset"})`, oxcOptions: [{ reset: false }] },
  { code: `React.createElement("button", {type: condition ? "button" : foo})` },
  { code: `React.createElement("button", {type: condition ? "button" : "foo"})` },
  {
    code: `React.createElement("button", {type: condition ? "button" : "reset"})`,
    oxcOptions: [{ reset: false }],
  },
  { code: `React.createElement("button", {type: condition ? foo : "button"})` },
  { code: `React.createElement("button", {type: condition ? "foo" : "button"})` },
  {
    code: `React.createElement("button", {type: condition ? "reset" : "button"})`,
    oxcOptions: [{ reset: false }],
  },
  {
    code: `React.createElement("button", {type: condition ? "reset" : "button"})`,
    oxcOptions: [{ reset: false, submit: false }],
  },
  { code: `Foo.createElement("button")` },
  {
    code: `function Button({ type, ...extraProps }) { const button = type; return <button type={button} {...extraProps} />; }`,
  },
];
