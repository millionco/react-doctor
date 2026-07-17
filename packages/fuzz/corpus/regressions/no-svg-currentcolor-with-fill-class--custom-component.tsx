// rule: no-svg-currentcolor-with-fill-class
// weakness: component-provenance
// source: PR #850 Cursor Bugbot review

interface IconProps {
  className: string;
  fill: string;
}

const Icon = ({ className, fill }: IconProps) => <span className={className} data-fill={fill} />;

export const CustomIcon = () => <Icon fill="currentColor" className="fill-zinc-400" />;
