// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/control_has_associated_label.rs`
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
    code: `<CustomControl><span><span>Save</span></span></CustomControl>`,
    oxcOptions: [
      {
        depth: 3,
        controlComponents: ["CustomControl"],
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<CustomControl><span><span label="Save"></span></span></CustomControl>`,
    oxcOptions: [
      {
        depth: 3,
        controlComponents: ["CustomControl"],
        labelAttributes: ["label"],
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<CustomControl>Save</CustomControl>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
    oxcSettings: { settings: { "jsx-a11y": { components: { CustomControl: "button" } } } },
  },
  {
    code: `<button>Save</button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span>Save</span></button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span><span>Save</span></span></button>`,
    oxcOptions: [
      {
        depth: 3,
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span><span><span><span><span><span><span><span>Save</span></span></span></span></span></span></span></span></button>`,
    oxcOptions: [
      {
        depth: 9,
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><img alt="Save" /></button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span aria-label="Save" /></button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span aria-labelledby="js_1" /></button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button>{sureWhyNot}</button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span><span label="Save"></span></span></button>`,
    oxcOptions: [
      {
        depth: 3,
        labelAttributes: ["label"],
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<a href="#">Save</a>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<area href="#">Save</area>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<link>Save</link>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<menuitem>Save</menuitem>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<option>Save</option>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<th>Save</th>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="button">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="checkbox">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="columnheader">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="combobox">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="gridcell">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="link">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitem">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitemcheckbox">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitemradio">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="option">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="progressbar">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="radio">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="rowheader">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="searchbox">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="slider">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="spinbutton">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="switch">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="tab">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="textbox">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="treeitem">Save</div>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="button" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="checkbox" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="columnheader" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="combobox" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="gridcell" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="link" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitem" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitemcheckbox" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitemradio" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="option" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="progressbar" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="radio" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="rowheader" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="searchbox" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="slider" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="spinbutton" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="switch" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="tab" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="textbox" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="treeitem" aria-label="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="button" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="checkbox" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="columnheader" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="combobox" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="gridcell" aria-labelledby="Save" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="link" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitem" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitemcheckbox" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitemradio" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="option" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="progressbar" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="radio" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="rowheader" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="searchbox" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="slider" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="spinbutton" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="switch" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="tab" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="textbox" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="treeitem" aria-labelledby="js_1" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<abbr />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<article />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<blockquote />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<br />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<caption />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<dd />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<details />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<dfn />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<dialog />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<dir />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<dl />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<dt />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<fieldset />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<figcaption />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<figure />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<footer />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<form />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<frame />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<h1 />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<h2 />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<h3 />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<h4 />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<h5 />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<h6 />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<hr />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<iframe />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<img />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<label />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<legend />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<li />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<link />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<main />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<mark />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<marquee />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<menu />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<meter />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<nav />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<ol />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<p />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<pre />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<progress />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<ruby />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<section />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<table />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<tbody />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<tfoot />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<thead />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<time />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<ul />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="alert" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="alertdialog" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="application" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="article" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="banner" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="cell" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="complementary" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="contentinfo" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="definition" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="dialog" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="directory" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="document" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="feed" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="figure" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="form" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="group" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="heading" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="img" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="list" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="listitem" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="log" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="main" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="marquee" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="math" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="navigation" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="none" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="note" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="presentation" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="progressbar" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="region" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="rowgroup" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="search" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="status" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="table" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="tabpanel" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="term" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="timer" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="tooltip" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="button" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="checkbox" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="color" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="date" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="datetime" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="email" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="file" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="hidden" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="hidden" name="bot-field"/>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="hidden" name="form-name" value="Contact Form"/>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="image" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="month" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="number" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="password" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="radio" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="range" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="reset" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="search" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="submit" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="tel" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="text" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<label>Foo <input type="text" /></label>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input name={field.name} id="foo" type="text" value={field.value} disabled={isDisabled} onChange={changeText(field.onChange, field.name)} onBlur={field.onBlur} />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="time" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="url" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<input type="week" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<audio />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<canvas />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<embed />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<textarea />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<tr />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<video />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="grid" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="listbox" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menu" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menubar" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="radiogroup" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="row" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="tablist" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="toolbar" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="tree" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="treegrid" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `<button />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span /></button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><img /></button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span title="This is not a real label" /></button>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<button><span><span><span>Save</span></span></span></button>`,
    oxcOptions: [
      {
        depth: 3,
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<CustomControl><span><span></span></span></CustomControl>`,
    oxcOptions: [
      {
        depth: 3,
        controlComponents: ["CustomControl"],
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<CustomControl></CustomControl>`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
    oxcSettings: { settings: { "jsx-a11y": { components: { CustomControl: "button" } } } },
  },
  {
    code: `<a href="#" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<area href="#" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<menuitem />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<option />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<th />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<td />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="button" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="checkbox" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="columnheader" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="combobox" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="link" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="gridcell" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitem" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitemcheckbox" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="menuitemradio" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="option" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="radio" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="rowheader" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="scrollbar" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="searchbox" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="separator" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="slider" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="spinbutton" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="switch" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="tab" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
  {
    code: `<div role="textbox" />`,
    oxcOptions: [
      {
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
        ignoreRoles: [
          "grid",
          "listbox",
          "menu",
          "menubar",
          "radiogroup",
          "row",
          "tablist",
          "toolbar",
          "tree",
          "treegrid",
        ],
      },
    ],
  },
];
