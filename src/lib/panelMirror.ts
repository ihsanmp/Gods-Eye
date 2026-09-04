/**
 * Reading a HUD panel's controls so the menu card can mirror them.
 *
 * The panels cannot be moved. Their layout is written against their parent -
 * dozens of rules keyed on `#left-panel-stack > #data-panel` and friends, plus
 * cockpit mode, clean view and recording mode - so lifting a panel node into a
 * card would strip all of that and it would render wrong.
 *
 * So the card mirrors instead of moving: it reads the real controls, draws its
 * own rows for them, and forwards a click or a value straight back to the
 * original element. Every listener, every binding and every piece of panel
 * logic stays exactly where it was, and the mirror cannot drift out of step
 * with the panel because it has no state of its own - it re-reads.
 */

export type MirrorKind = 'button' | 'select' | 'text' | 'range' | 'checkbox';

export interface MirrorControl {
  key: string;
  kind: MirrorKind;
  label: string;
  /** For buttons: whether the panel is showing this control as engaged. */
  on: boolean;
  /**
   * True for on/off controls, false for the choose-one and do-something kind.
   * A feed toggle needs to read OFF to be worth a row; CARI RUTE labelled OFF
   * would just be wrong, so the two are drawn differently.
   */
  toggle: boolean;
  value: string;
  min: string;
  max: string;
  step: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  el: HTMLElement;
}

/**
 * The text a person would read off the control.
 *
 * Icons in this app are Material Symbols ligatures - a span whose text is the
 * glyph name, marked aria-hidden. Plain textContent therefore yields
 * "rocket_launch SPACE MISSIONS". Skipping aria-hidden subtrees is the same
 * rule a screen reader applies, so the card reads the control exactly as
 * assistive technology does rather than by a list of class names that would
 * rot the moment the markup changed.
 */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Panels label their controls four different ways; this takes them in order. */
function labelFor(el: Element, overrides: Record<string, string>): string {
  if (el.id && overrides[el.id]) return overrides[el.id];

  const aria = el.getAttribute('aria-label');
  // Data layer toggles carry their state in the label ("Live Flights: OFF").
  // The row shows state separately, so it is trimmed off here.
  if (aria) return aria.replace(/\s*:\s*(ON|OFF)\s*$/i, '').trim();

  const inner = el.querySelector('.pp-label, .data-name, .layer-name');
  if (inner?.textContent?.trim()) return inner.textContent.trim();

  if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder;

  // A <select>'s textContent is every option run together, which is noise
  // rather than a name - so it is never used as one.
  if (!(el instanceof HTMLSelectElement)) {
    const text = visibleText(el);
    if (text) return text;
  }

  return el.getAttribute('title') || '';
}

/** On/off, as opposed to choose-one or do-something. */
function isToggle(el: Element): boolean {
  if (el.hasAttribute('data-feed-state')) return true;
  if (/:\s*(ON|OFF)\s*$/i.test(el.getAttribute('aria-label') || '')) return true;
  if (el.classList.contains('pp-toggle-btn')) return true;
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return true;
  return false;
}

/** The panels signal "engaged" in several ways, none of them shared. */
function isOn(el: Element): boolean {
  if (el.classList.contains('active')) return true;
  if (el.getAttribute('aria-selected') === 'true') return true;
  if (el.getAttribute('data-feed-state') === 'on') return true;
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
  return false;
}

function kindOf(el: Element): MirrorKind | null {
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'range') return 'range';
    if (el.type === 'text' || el.type === 'search') return 'text';
    return null;
  }
  if (el instanceof HTMLButtonElement) return 'button';
  return null;
}

/**
 * Read the controls a card should show for one panel.
 *
 * `selector` is curated per panel rather than "every button", so the card does
 * not mirror collapse chevrons, pin buttons and other panel chrome that would
 * be meaningless once the panel is not the thing you are looking at.
 */
export function readPanelControls(
  panelId: string,
  selector: string,
  labelOverrides: Record<string, string> = {}
): MirrorControl[] {
  const panel = document.getElementById(panelId);
  if (!panel) return [];

  const seen = new Set<Element>();
  const controls: MirrorControl[] = [];

  for (const el of panel.querySelectorAll(selector)) {
    if (seen.has(el)) continue;
    seen.add(el);
    const kind = kindOf(el);
    if (!kind) continue;
    const label = labelFor(el, labelOverrides);
    if (!label) continue;

    const input = el as HTMLInputElement;
    controls.push({
      key: `${panelId}:${controls.length}:${label}`,
      kind,
      label,
      on: isOn(el),
      toggle: isToggle(el),
      value: 'value' in el ? String(input.value ?? '') : '',
      min: input.min ?? '',
      max: input.max ?? '',
      step: input.step ?? '',
      options:
        el instanceof HTMLSelectElement
          ? [...el.options].map((option) => ({
              value: option.value,
              label: (option.textContent || option.value).trim()
            }))
          : [],
      disabled: 'disabled' in el ? Boolean(input.disabled) : false,
      el: el as HTMLElement
    });
  }

  return controls;
}

/** Press the real control. Its own handler does the work; nothing is copied. */
export function pressControl(control: MirrorControl): void {
  control.el.click();
}

/**
 * Write a value onto the real control and let it react.
 *
 * The panels are vanilla DOM, not React, so assigning `.value` and dispatching
 * the event the panel already listens for is enough - there is no framework
 * value tracker to defeat.
 */
export function setControlValue(control: MirrorControl, value: string | boolean): void {
  const el = control.el as HTMLInputElement | HTMLSelectElement;
  if (control.kind === 'checkbox') {
    (el as HTMLInputElement).checked = Boolean(value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
