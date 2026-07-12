// rule: no-array-index-as-key
// weakness: control-flow
// source: react-bench write-react-blueberrycongee-lumina-note-237

interface LicenseFeaturesProps {
  features: ReadonlyArray<string>;
}

export const LicenseFeatures = ({ features }: LicenseFeaturesProps) => (
  <ul>
    {features.map((feature, index) => (
      <li key={`${feature}-${index}`}>{feature}</li>
    ))}
  </ul>
);
