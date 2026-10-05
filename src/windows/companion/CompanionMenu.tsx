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
import { MenuAvatar } from "@/windows/companion/MenuAvatar";
import { type MenuItem, type MenuPage, useMenuItems } from "@/windows/companion/menuItems";
import {
  BUTTON_SIZE,
  buttonAt,
  buttonOffset,
  labelOffset,
  menuCenter,
  menuExtent,
  type Point,
} from "@/windows/companion/menuLayout";
import styles from "./CompanionMenu.module.css";

// The whole window catches clicks while the menu is open, so a click beside the buttons
// closes it instead of passing through to the desktop.
const hitRegion = { [HIT_REGION_ATTRIBUTE]: true };

// Character choices are radio items, so assistive tech reads which one is current.
function roleOf(item: MenuItem) {
  return item.checked === undefined
    ? { role: "menuitem" }
    : { role: "menuitemradio", "aria-checked": item.checked };
}

interface CompanionMenuProps {
  anchor: MenuAnchor;
}

/**
 * The right-click menu (D41), with the character ring as a second page (D42). Mounted only
 * while open; remount it to reopen elsewhere.
 */
export function CompanionMenu({ anchor }: CompanionMenuProps) {
  const [page, setPage] = useState<MenuPage>("main");
  const items = useMenuItems(page);
  const close = useMenuStore((state) => state.close);
  const [active, setActive] = useState<number | null>(null);
  // The main ring's item that opened the current page, to highlight again on the way back.
  const [opener, setOpener] = useState(0);
  // Where the current page wants its centre. A page swap starts from the previous centre, so
  // the menu only moves if the new ring would not fit there.
  const [origin, setOrigin] = useState<Point>(anchor);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = items.length;
  const center = useMemo(
    () => menuCenter(origin, count, { width: window.innerWidth, height: window.innerHeight }),
    [origin, count],
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

  function showPage(next: MenuPage, highlight: number | null) {
    // A clicked button takes focus and is unmounted by the swap, which would drop focus to
    // the body and leave the keys unheard.
    rootRef.current?.focus();
    setOrigin(center);
    setPage(next);
    setActive(highlight);
  }

  /** Back to the main ring, or closes the menu from there. */
  function back(byKeyboard: boolean) {
    if (page === "main") {
      close();
    } else {
      showPage("main", byKeyboard ? opener : null);
    }
  }

  function choose(item: MenuItem, index: number, byKeyboard: boolean) {
    if ("opens" in item) {
      setOpener(index);
      showPage(item.opens, byKeyboard ? 0 : null);
      return;
    }
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
    if (item && index !== null) {
      choose(item, index, false);
    } else {
      close();
    }
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    const offset = offsetOf(event);
    // Off the menu, the companion decides: reopen on the model, close elsewhere. On it,
    // right-click steps back like Escape, but never closes from the main ring.
    if (Math.hypot(offset.x, offset.y) <= menuExtent(count)) {
      event.stopPropagation();
      if (page !== "main") back(false);
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
        back(true);
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
        if (activeItem && active !== null) choose(activeItem, active, true);
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
      aria-label={page === "main" ? "Companion menu" : "Characters"}
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
              {...roleOf(item)}
              tabIndex={-1}
              aria-label={item.label}
              aria-haspopup={"opens" in item ? "menu" : undefined}
              className={styles.button}
              data-tone={item.tone}
              data-active={index === active}
              style={style}
            >
              <span className={styles.face}>
                {item.face.kind === "icon" ? (
                  <Icon name={item.face.icon} className={styles.icon} />
                ) : (
                  <MenuAvatar name={item.face.name} iconUrl={item.face.iconUrl} />
                )}
                {item.checked && (
                  <span className={styles.badge}>
                    <Icon name="check" className={styles.badgeIcon} />
                  </span>
                )}
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
