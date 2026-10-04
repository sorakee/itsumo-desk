import { ICONS, type IconName } from "@/shared/icons";

interface IconProps {
  name: IconName;
  className?: string;
}

/** A decorative stroke icon in the current text colour; label the control that holds it. */
export function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
