const DEFAULT_ICON_SIZE_PX = 40;

interface ReactDoctorIconProps {
  sizePx?: number;
  className?: string;
  alt?: string;
}

const ReactDoctorIcon = ({
  sizePx = DEFAULT_ICON_SIZE_PX,
  className,
  alt = "React Doctor icon",
}: ReactDoctorIconProps) => (
  <img
    src="/react-doctor-icon.svg"
    width={sizePx}
    height={sizePx}
    alt={alt}
    className={className}
  />
);

export default ReactDoctorIcon;
