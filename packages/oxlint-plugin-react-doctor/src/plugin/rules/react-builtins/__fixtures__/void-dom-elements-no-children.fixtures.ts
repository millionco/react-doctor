// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/void_dom_elements_no_children.rs`
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
  { code: `<div>Foo</div>;` },
  { code: `<div children='Foo' />;` },
  { code: `<div dangerouslySetInnerHTML={{ __html: 'Foo' }} />;` },
  { code: `React.createElement('div', {}, 'Foo');` },
  { code: `React.createElement('div', { children: 'Foo' });` },
  { code: `React.createElement('div', { dangerouslySetInnerHTML: { __html: 'Foo' } });` },
  { code: `React.createElement('img');` },
  { code: `React.createElement();` },
  {
    code: `
                const props = {};
                React.createElement('img', props);
            `,
  },
  {
    code: `
                import React, {createElement} from 'react';
                createElement('div');
            `,
  },
  {
    code: `
                import React, {createElement} from 'react';
                createElement('img');
            `,
  },
  {
    code: `
                import React, {createElement, PureComponent} from 'react';
                class Button extends PureComponent {
                    handleClick(ev) {
                        ev.preventDefault();
                    }
                    render() {
                        return <div onClick={this.handleClick}>Hello</div>;
                    }
                }
            `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<br>Foo</br>;` },
  { code: `<br children='Foo' />;` },
  { code: `<img {...props} children='Foo' />;` },
  { code: `<br dangerouslySetInnerHTML={{ __html: 'Foo' }} />;` },
  { code: `React.createElement('br', {}, 'Foo');` },
  { code: `React.createElement('br', { children: 'Foo' });` },
  { code: `React.createElement('br', { dangerouslySetInnerHTML: { __html: 'Foo' } });` },
  {
    code: `
                import React, {createElement} from 'react';
                createElement('img', {}, 'Foo');
            `,
  },
  {
    code: `
                import React, {createElement} from 'react';
                createElement('img', { children: 'Foo' });
            `,
  },
  {
    code: `
                import React, {createElement} from 'react';
                createElement('img', { dangerouslySetInnerHTML: { __html: 'Foo' } });
            `,
  },
];
