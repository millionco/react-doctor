// rule: no-generic-purple-blue-icon-gradient
// weakness: wrapper-transparency
// source: PR #1337 detector audit

const IconTile = ({ className }) => <span className={className} />;

const BrandedIcon = () => (
  <IconTile className="size-8 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 flex" />
);

export default BrandedIcon;
