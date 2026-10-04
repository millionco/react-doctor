// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/label_has_associated_control.rs`
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
    code: `<label htmlFor="js_id"><span><span><span>A label</span></span></span></label>`,
    oxcOptions: [{ depth: 4, assert: "htmlFor" }],
  },
  { code: `<label htmlFor="js_id" aria-label="A label" />`, oxcOptions: [{ assert: "htmlFor" }] },
  {
    code: `<label htmlFor="js_id" aria-labelledby="A label" />`,
    oxcOptions: [{ assert: "htmlFor" }],
  },
  {
    code: `<div><label htmlFor="js_id">A label</label><input id="js_id" /></div>`,
    oxcOptions: [{ assert: "htmlFor" }],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [{ labelComponents: ["CustomLabel"], assert: "htmlFor" }],
  },
  {
    code: `<CustomLabel htmlFor="js_id" label="A label" />`,
    oxcOptions: [
      {
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [{ assert: "htmlFor" }],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label htmlFor="js_id" label="A label" />`,
    oxcOptions: [{ labelAttributes: ["label"], assert: "htmlFor" }],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [{ controlComponents: ["Custom*"], assert: "htmlFor" }],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [{ controlComponents: ["*Label"], assert: "htmlFor" }],
  },
  {
    code: `<label htmlFor="js_id"><span><span><span>A label</span></span></span></label>`,
    oxcOptions: [{ depth: 4, assert: "either" }],
  },
  { code: `<label htmlFor="js_id" aria-label="A label" />`, oxcOptions: [{ assert: "either" }] },
  {
    code: `<label htmlFor="js_id" aria-labelledby="A label" />`,
    oxcOptions: [{ assert: "either" }],
  },
  {
    code: `<div><label htmlFor="js_id">A label</label><input id="js_id" /></div>`,
    oxcOptions: [{ assert: "either" }],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [{ labelComponents: ["CustomLabel"], assert: "either" }],
  },
  {
    code: `<CustomLabel htmlFor="js_id" label="A label" />`,
    oxcOptions: [
      {
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
        assert: "either",
      },
    ],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [{ assert: "either" }],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label htmlFor="js_id" label="A label" />`,
    oxcOptions: [{ labelAttributes: ["label"], assert: "either" }],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [{ controlComponents: ["Custom*"], assert: "either" }],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [{ controlComponents: ["*Label"], assert: "either" }],
  },
  { code: `<label>A label<input /></label>`, oxcOptions: [{ assert: "nesting" }] },
  { code: `<label>A label<textarea /></label>`, oxcOptions: [{ assert: "nesting" }] },
  { code: `<label><img alt="A label" /><input /></label>`, oxcOptions: [{ assert: "nesting" }] },
  {
    code: `<label><img aria-label="A label" /><input /></label>`,
    oxcOptions: [{ assert: "nesting" }],
  },
  { code: `<label><span>A label<input /></span></label>`, oxcOptions: [{ assert: "nesting" }] },
  {
    code: `<label><span><span>A label<input /></span></span></label>`,
    oxcOptions: [{ assert: "nesting", depth: 3 }],
  },
  {
    code: `<label><span><span><span>A label<input /></span></span></span></label>`,
    oxcOptions: [{ assert: "nesting", depth: 4 }],
  },
  {
    code: `<label><span><span><span><span>A label</span><input /></span></span></span></label>`,
    oxcOptions: [{ assert: "nesting", depth: 5 }],
  },
  {
    code: `<label><span><span><span><span aria-label="A label" /><input /></span></span></span></label>`,
    oxcOptions: [{ assert: "nesting", depth: 5 }],
  },
  {
    code: `<label><span><span><span><input aria-label="A label" /></span></span></span></label>`,
    oxcOptions: [{ assert: "nesting", depth: 5 }],
  },
  { code: `<label>foo<meter /></label>`, oxcOptions: [{ assert: "nesting" }] },
  { code: `<label>foo<output /></label>`, oxcOptions: [{ assert: "nesting" }] },
  { code: `<label>foo<progress /></label>`, oxcOptions: [{ assert: "nesting" }] },
  { code: `<label>foo<textarea /></label>`, oxcOptions: [{ assert: "nesting" }] },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [{ assert: "nesting", controlComponents: ["CustomInput"] }],
  },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [{ assert: "nesting" }],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<CustomLabel><span>A label<CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      { assert: "nesting", controlComponents: ["CustomInput"], labelComponents: ["CustomLabel"] },
    ],
  },
  {
    code: `<CustomLabel><span label="A label"><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "nesting",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "nesting",
        controlComponents: ["Custom*"],
      },
    ],
  },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "nesting",
        controlComponents: ["*Input"],
      },
    ],
  },
  { code: `<label>A label<input /></label>`, oxcOptions: [{ assert: "either" }] },
  { code: `<label>A label<textarea /></label>`, oxcOptions: [{ assert: "either" }] },
  { code: `<label><img alt="A label" /><input /></label>`, oxcOptions: [{ assert: "either" }] },
  {
    code: `<label><img aria-label="A label" /><input /></label>`,
    oxcOptions: [{ assert: "either" }],
  },
  { code: `<label><span>A label<input /></span></label>`, oxcOptions: [{ assert: "either" }] },
  {
    code: `<label><span><span>A label<input /></span></span></label>`,
    oxcOptions: [{ assert: "either", depth: 3 }],
  },
  {
    code: `<label><span><span><span>A label<input /></span></span></span></label>`,
    oxcOptions: [{ assert: "either", depth: 4 }],
  },
  {
    code: `<label><span><span><span><span>A label</span><input /></span></span></span></label>`,
    oxcOptions: [{ assert: "either", depth: 5 }],
  },
  {
    code: `<label><span><span><span><span aria-label="A label" /><input /></span></span></span></label>`,
    oxcOptions: [{ assert: "either", depth: 5 }],
  },
  {
    code: `<label><span><span><span><input aria-label="A label" /></span></span></span></label>`,
    oxcOptions: [{ assert: "either", depth: 5 }],
  },
  { code: `<label>foo<meter /></label>`, oxcOptions: [{ assert: "either" }] },
  { code: `<label>foo<output /></label>`, oxcOptions: [{ assert: "either" }] },
  { code: `<label>foo<progress /></label>`, oxcOptions: [{ assert: "either" }] },
  { code: `<label>foo<textarea /></label>`, oxcOptions: [{ assert: "either" }] },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [{ assert: "either", controlComponents: ["CustomInput"] }],
  },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [{ assert: "either" }],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<CustomLabel><span>A label<CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      { assert: "either", controlComponents: ["CustomInput"], labelComponents: ["CustomLabel"] },
    ],
  },
  {
    code: `<CustomLabel><span label="A label"><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "either",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "either",
        controlComponents: ["Custom*"],
      },
    ],
  },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "either",
        controlComponents: ["*Input"],
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><span><span><span>A label<input /></span></span></span></label>`,
    oxcOptions: [
      {
        assert: "both",
        depth: 4,
      },
    ],
  },
  {
    code: `<label htmlFor="js_id" aria-label="A label"><input /></label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id" aria-labelledby="A label"><input /></label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id" aria-labelledby="A label"><textarea /></label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label"><input /></CustomLabel>`,
    oxcOptions: [
      {
        assert: "both",
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel htmlFor="js_id" label="A label"><input /></CustomLabel>`,
    oxcOptions: [
      {
        assert: "both",
        labelAttributes: ["label"],
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label"><input /></CustomLabel>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label"><CustomInput /></CustomLabel>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label htmlFor="js_id" label="A label"><input /></label>`,
    oxcOptions: [
      {
        assert: "both",
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label htmlFor="selectInput">Some text<select id="selectInput" /></label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<div />`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<div />`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<div />`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<div />`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<CustomElement />`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<CustomElement />`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<CustomElement />`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<CustomElement />`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<input type="hidden" />`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<input type="hidden" />`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<input type="hidden" />`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<input type="hidden" />`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<div><label htmlFor="js_id"><CustomText /></label><input id="js_id" /></div>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label><CustomText /><input /></label>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<div><label htmlFor="js_id"><CustomText /></label><input id="js_id" /></div>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<label><CustomText /><input /></label>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<label for="js_id" aria-label="A label" />`,
    oxcOptions: [{ assert: "htmlFor" }],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          attributes: {
            for: ["htmlFor", "for"],
          },
        },
      },
    },
  },
  {
    code: `<label for="js_id">A label</label>`,
    oxcOptions: [{ assert: "either" }],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          attributes: {
            for: ["htmlFor", "for"],
          },
        },
      },
    },
  },
  {
    code: `<label for="js_id" aria-label="A label" />`,
    oxcOptions: [{ assert: "either" }],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          attributes: {
            for: ["htmlFor", "for"],
          },
        },
      },
    },
  },
  {
    code: `<label for="js_id" aria-label="A label"><input /></label>`,
    oxcOptions: [{ assert: "both" }],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          attributes: {
            for: ["htmlFor", "for"],
          },
        },
      },
    },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `<label htmlFor="js_id"><span><span><span>A label</span></span></span></label>`,
    oxcOptions: [
      {
        assert: "nesting",
        depth: 4,
      },
    ],
  },
  {
    code: `<label htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id" aria-labelledby="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel htmlFor="js_id" label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
        labelAttributes: ["label"],
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel htmlFor="js_id" aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label htmlFor="js_id" label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label>A label<input /></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label>A label<textarea /></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label><img alt="A label" /><input /></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label><img aria-label="A label" /><input /></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label><span>A label<input /></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label><span><span>A label<input /></span></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        depth: 3,
      },
    ],
  },
  {
    code: `<label><span><span><span>A label<input /></span></span></span></label>'`,
    oxcOptions: [
      {
        assert: "htmlFor",
        depth: 4,
      },
    ],
  },
  {
    code: `<label><span><span><span><span>A label</span><input /></span></span></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        depth: 5,
      },
    ],
  },
  {
    code: `<label><span><span><span><span aria-label="A label" /><input /></span></span></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        depth: 5,
      },
    ],
  },
  {
    code: `<label><span><span><span><input aria-label="A label" /></span></span></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        depth: 5,
      },
    ],
  },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        controlComponents: ["CustomInput"],
      },
    ],
  },
  {
    code: `<CustomLabel><span>A label<CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel><span label="A label"><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span>A label<CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<CustomLabel><span>A label<CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label htmlFor="js_id" />`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><input /></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><textarea /></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<label>A label</label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<div><label /><input /></div>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<div><label>A label</label><input /></div>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
  },
  {
    code: `<CustomLabel aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "htmlFor",
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel label="A label" />`,
    oxcOptions: [
      {
        assert: "htmlFor",
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<CustomLabel aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label label="A label" />`,
    oxcOptions: [
      {
        assert: "htmlFor",
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span><CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        controlComponents: ["CustomInput"],
      },
    ],
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "htmlFor",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span><CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "htmlFor",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label htmlFor="js_id" />`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><input /></label>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><textarea /></label>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<label></label>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<label>A label</label>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<div><label /><input /></div>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<div><label>A label</label><input /></div>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
  },
  {
    code: `<CustomLabel aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<CustomLabel aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label label="A label" />`,
    oxcOptions: [
      {
        assert: "nesting",
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span><CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "nesting",
        controlComponents: ["CustomInput"],
      },
    ],
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "nesting",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "nesting",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span><CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "nesting",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label htmlFor="js_id" />`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><input /></label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><textarea /></label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<label></label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<label>A label</label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<div><label /><input /></div>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<div><label>A label</label><input /></div>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
  },
  {
    code: `<CustomLabel aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "both",
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel label="A label" />`,
    oxcOptions: [
      {
        assert: "both",
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<CustomLabel aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label label="A label" />`,
    oxcOptions: [
      {
        assert: "both",
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span><CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "both",
        controlComponents: ["CustomInput"],
      },
    ],
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "both",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "both",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span><CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "both",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label htmlFor="js_id" />`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><input /></label>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<label htmlFor="js_id"><textarea /></label>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<label></label>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<label>A label</label>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<div><label /><input /></div>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<div><label>A label</label><input /></div>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
  },
  {
    code: `<CustomLabel aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "either",
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel label="A label" />`,
    oxcOptions: [
      {
        assert: "either",
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<CustomLabel aria-label="A label" />`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<label label="A label" />`,
    oxcOptions: [
      {
        assert: "either",
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span><CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "either",
        controlComponents: ["CustomInput"],
      },
    ],
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "either",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
      },
    ],
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "either",
        controlComponents: ["CustomInput"],
        labelComponents: ["CustomLabel"],
        labelAttributes: ["label"],
      },
    ],
  },
  {
    code: `<label><span><CustomInput /></span></label>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<CustomLabel><span><CustomInput /></span></CustomLabel>`,
    oxcOptions: [
      {
        assert: "either",
      },
    ],
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            CustomLabel: "label",
          },
        },
      },
    },
  },
  {
    code: `<FilesContext.Provider value={{ addAlert, cwdInfo }} />`,
    oxcOptions: [
      {
        labelComponents: ["FilesContext.Provider"],
      },
    ],
  },
  { code: `<label for="js_id">A label</label>`, oxcOptions: [{ assert: ["htmlFor"] }] },
  { code: `<label for="js_id" aria-label="A label" />`, oxcOptions: [{ assert: ["htmlFor"] }] },
];
