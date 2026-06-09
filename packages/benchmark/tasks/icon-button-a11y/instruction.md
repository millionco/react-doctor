Implement the `IconButton` component in `src/icon-button.tsx`.

## Expected behavior

`IconButton` renders an icon-only clickable control. It receives:

- `label` — an accessible name for the control.
- `glyph` — the icon character to display (e.g. `"×"`).
- `onPress` — called when the control is activated.

The rendered control must:

- expose the accessible name `label` to assistive technology,
- display the `glyph` as its visible content,
- invoke `onPress` when activated.

Example: `<IconButton label="Close" glyph="×" onPress={fn} />` renders a control
named "Close" showing `×`.

## Constraints

Keep the exported `IconButton` component and the `IconButtonProps` type.
