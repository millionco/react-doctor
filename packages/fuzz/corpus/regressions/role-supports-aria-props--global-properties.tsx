// rule: role-supports-aria-props
// weakness: library-idiom
// source: React Bench write-react-hyparam-hightable-451
export const HightableHeaders = ({ description, columnName, width }) => (
  <>
    <th role="columnheader" aria-label={columnName} aria-description={description} />
    <span
      role="spinbutton"
      aria-label="Resize column"
      aria-description="Resize instructions"
      aria-valuenow={width}
    />
  </>
);
