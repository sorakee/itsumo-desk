import { useState } from "react";
import { initialOf } from "@/shared/initial";
import styles from "./MenuAvatar.module.css";

interface MenuAvatarProps {
  name: string;
  iconUrl: string | null;
}

/** A character's face on a menu button: its icon, or its initial when it has none (or it fails). */
export function MenuAvatar({ name, iconUrl }: MenuAvatarProps) {
  const [failed, setFailed] = useState(false);
  if (iconUrl && !failed) {
    return (
      <img
        className={styles.image}
        src={iconUrl}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className={styles.initial} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}
