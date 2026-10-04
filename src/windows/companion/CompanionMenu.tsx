import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { focusWindow } from "@/ipc";
import { Icon } from "@/shared/Icon";
import { type MenuAnchor, useMenuStore } from "@/stores/menu";
import { HIT_REGION_ATTRIBUTE } from "@/windows/companion/interaction";
import { type MenuItem, useMenuItems } from "@/windows/companion/menuItems";
import {
  BUTTON_SIZE,
  buttonAt,
  buttonOffset,
  labelOffset,
  menuCenter,
  menuExtent,
} from "@/windows/companion/menuLayout";
import styles from "./CompanionMenu.module.css";

// The whole window catches clicks while the menu is open, so a click beside the buttons
// closes it instead of passing through to the desktop.
const hitRegion = { [HIT_REGION_ATTRIBUTE]: true };

interface CompanionMenuProps {
  anchor: MenuAnchor;
}

/** The right-click menu (D41). Mounted only while open; remount it to reopen elsewhere. */
export function CompanionMenu({ anchor }: CompanionMenuProps) {
  const items = useMenuItems();
  const close = useMenuStore((state) => state.close);
  const [active, setActive] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = items.length;
  const center = useMemo(
    () => menuCenter(anchor, count, { width: window.innerWidth, height: window.innerHeight }),
    [anchor, count],
  );
  const activeItem = active === null ? undefined : items[active];

  useEffect(() => {
    rootRef.current?.focus();
    // Escape and closing on blur both need the window to have keyboard focus.
    focusWindow().catch((error: unknown) => console.warn("failed to focus the companion", error));
    // A click in another app blurs the window; a resize would leave the menu misplaced.
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [close]);

  function offsetOf(event: MouseEvent) {
    return { x: event.clientX - center.x, y: event.clientY - center.y };
  }

  function run(item: MenuItem) {
    close();
    item.run().catch((error: unknown) => console.warn(`failed to run menu item ${item.id}`, error));
  }

  function onPointerDown(event: PointerEvent) {
    // Keeps the companion's own press handling (window drag) out of the menu.
    event.stopPropagation();
  }

  function onClick(event: MouseEvent) {
    const index = buttonAt(offsetOf(event), count);
    const item = index === null ? undefined : items[index];
    if (item) {
      run(item);
    } else {
      close();
    }
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    const offset = offsetOf(event);
    // Off the menu, the companion decides: reopen on the model, close elsewhere.
    if (Math.hypot(offset.x, offset.y) <= menuExtent(count)) {
      event.stopPropagation();
    }
  }

  function step(by: number) {
    setActive((current) => {
      if (current === null) return by > 0 ? 0 : count - 1;
      return (current + by + count) % count;
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case "Escape":
        close();
        break;
      case "ArrowRight":
      case "ArrowDown":
        step(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        step(-1);
        break;
      case "Tab":
        step(event.shiftKey ? -1 : 1);
        break;
      case "Enter":
      case " ":
        if (activeItem) run(activeItem);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const label = labelOffset(count);
  const labelStyle = { left: label.x, top: label.y };
  const menuStyle = {
    left: center.x,
    top: center.y,
    "--button-size": `${BUTTON_SIZE}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={styles.backdrop}
      role="menu"
      aria-label="Companion menu"
      aria-activedescendant={activeItem ? `menu-${activeItem.id}` : undefined}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => setActive(buttonAt(offsetOf(event), count))}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      {...hitRegion}
    >
      <div className={styles.menu} style={menuStyle}>
        {items.map((item, index) => {
          const offset = buttonOffset(index, count);
          const style = {
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            "--index": index,
          } as CSSProperties;
          return (
            <button
              key={item.id}
              id={`menu-${item.id}`}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={item.label}
              className={styles.button}
              data-tone={item.tone}
              data-active={index === active}
              style={style}
            >
              <span className={styles.face}>
                <Icon name={item.icon} className={styles.icon} />
              </span>
            </button>
          );
        })}
        {activeItem && (
          <p key={activeItem.id} className={styles.label} style={labelStyle} aria-hidden="true">
            {activeItem.label}
          </p>
        )}
      </div>
    </div>
  );
}
