import { useState } from "react";
import { initialOf } from "@/shared/initial";
import styles from "./CharacterAvatar.module.css";

interface CharacterAvatarProps {
  name: string;
  iconUrl: string | null;
  size?: "small" | "large";
}

/** The pack's icon, or the first letter of its name when it has none (or it fails to load). */
export function CharacterAvatar({ name, iconUrl, size = "small" }: CharacterAvatarProps) {
  const [failed, setFailed] = useState(false);
  const className = `${styles.avatar} ${styles[size]}`;
  if (iconUrl && !failed) {
    return <img className={className} src={iconUrl} alt="" onError={() => setFailed(true)} />;
  }
  return (
    <span className={className} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}
