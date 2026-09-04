import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cctv,
  Clapperboard,
  Layers,
  Menu as MenuIcon,
  Palette,
  Radar,
  Route,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { MenuContainer, MenuItem } from '@/components/ui/fluid-menu';
import { MenuPopover } from '@/components/ui/menu-popover';
import {
  pressControl,
  readPanelControls,
  setControlValue,
  type MirrorControl
} from '@/lib/panelMirror';
import '@/tailwind.css';

/**
 * One fluid menu in place of seven separate panel chips.
 *
 * DATA LAYERS, RUTE, SCENES, DISPLAY, CCTV, CONTEXT and VISUAL PRESETS each had
 * their own collapsed chip scattered around the edges of the screen. They are
 * now one circular menu: the chips are hidden by CSS and this opens them.
 *
 * Clicking an icon opens a card beside it, in the shape of the reference
 * recording. The card mirrors that panel's real controls - it reads them and
 * forwards clicks and values back - so the panels themselves are never moved
 * or reimplemented. Anything the card cannot hold (typing with live
 * suggestions, the CCTV video, the context readouts) is one button away: every
 * card opens the full panel where it has always lived.
 */

interface PanelEntry {
  id: string;
  label: string;
  /** The one line under the title, as the recording's card has. */
  description: string;
  /**
   * Which controls the card mirrors. Curated per panel rather than "every
   * button", so collapse chevrons and pin buttons - chrome that means nothing
   * outside the panel - stay out of the card.
   */
  controls: string;
  /** Names for controls that carry none of their own, chiefly <select>s. */
  labels?: Record<string, string>;
  /** Shown instead of rows when the panel's real work needs the full panel. */
  note?: string;
  icon: React.ReactNode;
}

/** Icons chosen for what each panel does here, not for the demo's navigation. */
const PANELS: PanelEntry[] = [
  {
    id: 'data-panel',
    label: 'Data Layers',
    description: 'Nyalakan lapisan data langsung di peta.',
    controls: '.data-toggle-btn',
    icon: <Layers size={24} strokeWidth={1.5} />
  },
  {
    id: 'route-panel',
    label: 'Rute',
    description: 'Cari rute tercepat lewat jalan normal.',
    controls: '#route-origin, #route-dest, #route-gps-btn, .scene-btn, #route-avoid-alleys',
    labels: {
      // The inputs carry only placeholders ("Ketik tempat, atau pakai GPS"),
      // which is a prompt rather than a name for the field.
      'route-origin': 'Asal',
      'route-dest': 'Tujuan',
      'route-avoid-alleys': 'Hindari gang sempit'
    },
    note: 'Sugesti tempat saat mengetik hanya muncul di panel penuh.',
    icon: <Route size={24} strokeWidth={1.5} />
  },
  {
    id: 'cctv-panel',
    label: 'CCTV',
    description: 'Pilih kamera lalu lintas dan arahkan kamera.',
    controls:
      '#cctv-enable-btn, #cctv-nearest-btn, #cctv-prev-btn, #cctv-camera-select, #cctv-next-btn, #cctv-focus-btn, #cctv-coverage-btn, #cctv-auto-hop-btn, #cctv-projection-btn',
    labels: { 'cctv-camera-select': 'Kamera' },
    note: 'Siaran videonya tampil di panel penuh.',
    icon: <Cctv size={24} strokeWidth={1.5} />
  },
  {
    id: 'global-context-panel',
    label: 'Context',
    description: 'Pantau kontak di sekitar area yang dibuka.',
    controls: '.context-mode-button',
    icon: <Radar size={24} strokeWidth={1.5} />
  },
  {
    id: 'pp-toggles',
    label: 'Display',
    description: 'Atur HUD dan efek tampilan.',
    controls: '.pp-toggle-btn, #hud-layout-select',
    labels: { 'hud-layout-select': 'Layout HUD' },
    icon: <SlidersHorizontal size={24} strokeWidth={1.5} />
  },
  {
    id: 'scene-panel',
    label: 'Scenes',
    description: 'Simpan dan panggil kembali sudut pandang.',
    controls: '#scene-select, #scene-new-btn, #scene-capture-btn, #scene-update-shot-btn',
    labels: { 'scene-select': 'Scene' },
    icon: <Clapperboard size={24} strokeWidth={1.5} />
  },
  {
    id: 'control-panel',
    label: 'Visual Presets',
    description: 'Ganti gaya visual peta.',
    controls: '.style-btn',
    icon: <Palette size={24} strokeWidth={1.5} />
  }
];

/** The circles are 64px tall and overlap by 16, so each item sits 48px lower. */
const ITEM_PITCH = 48;

function MirrorRow({ control }: { control: MirrorControl }) {
  if (control.kind === 'button') {
    return (
      <button
        type="button"
        className="gev-mirror-row"
        data-on={control.on ? 'true' : undefined}
        disabled={control.disabled}
        onClick={() => pressControl(control)}
      >
        <span className="gev-mirror-label">{control.label}</span>
        {control.toggle ? (
          <span className="gev-mirror-chip" data-on={control.on ? 'true' : undefined}>
            {control.on ? 'ON' : 'OFF'}
          </span>
        ) : null}
      </button>
    );
  }

  if (control.kind === 'checkbox') {
    return (
      <label className="gev-mirror-row gev-mirror-check">
        <span className="gev-mirror-label">{control.label}</span>
        <input
          type="checkbox"
          checked={control.on}
          onChange={(event) => setControlValue(control, event.target.checked)}
        />
      </label>
    );
  }

  if (control.kind === 'select') {
    return (
      <label className="gev-mirror-field">
        <span className="gev-mirror-label">{control.label}</span>
        <select
          value={control.value}
          onChange={(event) => setControlValue(control, event.target.value)}
        >
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (control.kind === 'range') {
    return (
      <label className="gev-mirror-field">
        <span className="gev-mirror-label">{control.label}</span>
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={control.value}
          onChange={(event) => setControlValue(control, event.target.value)}
        />
      </label>
    );
  }

  return (
    <label className="gev-mirror-field">
      <span className="gev-mirror-label">{control.label}</span>
      {/*
        Uncontrolled on purpose. The panel re-reads on every mutation, and a
        controlled value would fight the operator's own typing on each of those
        re-reads. The real input is the single source of truth either way.
      */}
      <input
        type="text"
        defaultValue={control.value}
        placeholder={control.label}
        onChange={(event) => setControlValue(control, event.target.value)}
      />
    </label>
  );
}

function FluidMenuHost() {
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const [cardFor, setCardFor] = useState<string | null>(null);
  /** Bumped whenever the mirrored panel changes, to re-read its controls. */
  const [revision, setRevision] = useState(0);

  /** Mirror the DOM, since a panel can also be collapsed by its own header. */
  const syncOpenState = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const panel of PANELS) {
      const el = document.getElementById(panel.id);
      next[panel.id] = Boolean(el) && !el!.classList.contains('collapsed');
    }
    setOpenPanels(next);
  }, []);

  useEffect(() => {
    syncOpenState();
    // Panels are collapsed and expanded by several paths - their own headers,
    // the adaptive layout engine, Cockpit entry - so the menu watches the class
    // rather than assuming it is the only thing that changes it.
    const observer = new MutationObserver(syncOpenState);
    for (const panel of PANELS) {
      const el = document.getElementById(panel.id);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    }
    return () => observer.disconnect();
  }, [syncOpenState]);

  /*
   * Keep the open card in step with its panel. Pressing a mirrored row runs the
   * panel's own handler, which is what flips the class or the value - so the
   * card learns the new state by watching, exactly as it would if the operator
   * had used the panel directly.
   */
  useEffect(() => {
    if (!cardFor) return;
    const el = document.getElementById(cardFor);
    if (!el) return;
    const bump = () => setRevision((value) => value + 1);
    const observer = new MutationObserver(bump);
    observer.observe(el, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'aria-label', 'aria-selected', 'data-feed-state', 'disabled']
    });
    el.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      el.removeEventListener('change', bump);
    };
  }, [cardFor]);

  const entry = useMemo(() => PANELS.find((panel) => panel.id === cardFor) || null, [cardFor]);

  const controls = useMemo(() => {
    if (!entry) return [];
    return readPanelControls(entry.id, entry.controls, entry.labels || {});
    // `revision` is the point of this dependency: it is what re-reads the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, revision]);

  const togglePanel = useCallback((id: string) => {
    const styleManager = (window as any).__godsEyeView?.styleManager;
    const el = document.getElementById(id);
    if (!styleManager?.setPanelCollapsed || !el) return;
    const collapsed = el.classList.contains('collapsed');
    // `explicit` marks this as the operator's own choice, which is what the
    // panel's own header button reports too - so the adaptive layout does not
    // treat it as something it may undo.
    styleManager.setPanelCollapsed(id, !collapsed, { explicit: true });
  }, []);

  const closeCard = useCallback(() => setCardFor(null), []);

  const anchorTop = entry ? (PANELS.indexOf(entry) + 1) * ITEM_PITCH : 0;

  return (
    <>
      <MenuContainer>
        <MenuItem
          label="Menu"
          onClick={closeCard}
          icon={
            <div className="relative w-6 h-6">
              <div className="absolute inset-0 transition-all duration-300 ease-in-out origin-center opacity-100 scale-100 rotate-0 [div[data-expanded=true]_&]:opacity-0 [div[data-expanded=true]_&]:scale-0 [div[data-expanded=true]_&]:rotate-180">
                <MenuIcon size={24} strokeWidth={1.5} />
              </div>
              <div className="absolute inset-0 transition-all duration-300 ease-in-out origin-center opacity-0 scale-0 -rotate-180 [div[data-expanded=true]_&]:opacity-100 [div[data-expanded=true]_&]:scale-100 [div[data-expanded=true]_&]:rotate-0">
                <X size={24} strokeWidth={1.5} />
              </div>
            </div>
          }
        />
        {PANELS.map((panel) => (
          <MenuItem
            key={panel.id}
            label={panel.label}
            icon={panel.icon}
            isActive={cardFor === panel.id || openPanels[panel.id]}
            onClick={() => setCardFor((current) => (current === panel.id ? null : panel.id))}
          />
        ))}
      </MenuContainer>

      {entry ? (
        <MenuPopover
          title={entry.label}
          description={entry.description}
          anchorTop={anchorTop}
          onClose={closeCard}
          footer={
            <button
              type="button"
              className="gev-menu-popover-primary"
              onClick={() => {
                togglePanel(entry.id);
                closeCard();
              }}
            >
              {openPanels[entry.id] ? 'Tutup panel penuh' : 'Buka panel penuh'}
            </button>
          }
        >
          {controls.length ? (
            controls.map((control) => <MirrorRow key={control.key} control={control} />)
          ) : (
            <div className="gev-mirror-empty">Panel ini belum siap.</div>
          )}
          {entry.note ? <div className="gev-mirror-note">{entry.note}</div> : null}
        </MenuPopover>
      ) : null}
    </>
  );
}

let root: Root | null = null;

/**
 * Mount the fluid menu into its own container, on the left edge below the
 * search bar. Its own node so React and the vanilla UI stay separated.
 */
export function mountFluidMenu(): void {
  if (root) return;
  const container = document.createElement('div');
  container.id = 'fluid-menu-root';
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(
    <StrictMode>
      <FluidMenuHost />
    </StrictMode>
  );
}
