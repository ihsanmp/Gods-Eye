import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useCallback, useEffect, useState } from 'react';
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
import '@/tailwind.css';

/**
 * One fluid menu in place of seven separate panel chips.
 *
 * DATA LAYERS, RUTE, SCENES, DISPLAY, CCTV, CONTEXT and VISUAL PRESETS each had
 * their own collapsed chip scattered around the edges of the screen. They are
 * now one circular menu: the chips are hidden by CSS and this opens them.
 *
 * The panels themselves are untouched - this is a launcher, not a replacement.
 * Each item toggles its panel through StyleManager's own setPanelCollapsed, so
 * collapse state, persistence and the adaptive layout keep working exactly as
 * they did.
 */

interface PanelEntry {
  id: string;
  label: string;
  icon: React.ReactNode;
}

/** Icons chosen for what each panel does here, not for the demo's navigation. */
const PANELS: PanelEntry[] = [
  { id: 'data-panel', label: 'Data Layers', icon: <Layers size={24} strokeWidth={1.5} /> },
  { id: 'route-panel', label: 'Rute', icon: <Route size={24} strokeWidth={1.5} /> },
  { id: 'cctv-panel', label: 'CCTV', icon: <Cctv size={24} strokeWidth={1.5} /> },
  { id: 'global-context-panel', label: 'Context', icon: <Radar size={24} strokeWidth={1.5} /> },
  { id: 'pp-toggles', label: 'Display', icon: <SlidersHorizontal size={24} strokeWidth={1.5} /> },
  { id: 'scene-panel', label: 'Scenes', icon: <Clapperboard size={24} strokeWidth={1.5} /> },
  { id: 'control-panel', label: 'Visual Presets', icon: <Palette size={24} strokeWidth={1.5} /> }
];

function FluidMenuHost() {
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});

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

  const toggle = useCallback((id: string) => {
    const styleManager = (window as any).__godsEyeView?.styleManager;
    const el = document.getElementById(id);
    if (!styleManager?.setPanelCollapsed || !el) return;
    const collapsed = el.classList.contains('collapsed');
    // `explicit` marks this as the operator's own choice, which is what the
    // panel's own header button reports too - so the adaptive layout does not
    // treat it as something it may undo.
    styleManager.setPanelCollapsed(id, !collapsed, { explicit: true });
  }, []);

  return (
    <MenuContainer>
      <MenuItem
        label="Menu"
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
          isActive={openPanels[panel.id]}
          onClick={() => toggle(panel.id)}
        />
      ))}
    </MenuContainer>
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
