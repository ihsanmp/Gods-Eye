import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The card the fluid menu opens on a click.
 *
 * Shaped after the reference recording: a dark rounded card anchored to the
 * control that opened it, with a bold title, a muted line of description, a
 * body, and a light primary action at the foot. It appears and disappears
 * outright - the reference shows no exit animation, so there is none here.
 *
 * The menu is a vertical column on the left edge, so the card sits to the
 * RIGHT of the item rather than below it, which is the same relationship the
 * recording has between its button and its card.
 */

interface MenuPopoverProps {
  title: string;
  description: string;
  /** Offset of the anchoring circle inside #fluid-menu-root, in pixels. */
  anchorTop: number;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function MenuPopover({
  title,
  description,
  anchorTop,
  onClose,
  children,
  footer
}: MenuPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchorTop);

  /*
   * Keep the whole card on screen. The lower items in a seven-item column are
   * far enough down that a card anchored level with them would hang off the
   * bottom, so it slides up by however much it overflows and no further.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const rootTop = parent.getBoundingClientRect().top;
    const lowest = window.innerHeight - 16 - rootTop - el.offsetHeight;
    const highest = 16 - rootTop;
    setTop(Math.max(highest, Math.min(anchorTop, lowest)));
  }, [anchorTop, children]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    /*
     * Close on a click anywhere else - except on a menu item, so that clicking
     * a different icon switches the card over instead of shutting it and
     * making the operator click twice.
     */
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (ref.current?.contains(target as Node)) return;
      if (target?.closest?.('#fluid-menu-root')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="gev-menu-popover"
      style={{ top }}
      role="dialog"
      aria-label={title}
    >
      <div className="gev-menu-popover-title">{title}</div>
      <div className="gev-menu-popover-desc">{description}</div>
      <div className="gev-menu-popover-body">{children}</div>
      {footer ? <div className="gev-menu-popover-footer">{footer}</div> : null}
    </div>
  );
}
