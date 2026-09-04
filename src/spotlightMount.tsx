import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';
import { AppleSpotlight } from '@/components/ui/apple-spotlight';
import '@/tailwind.css';

/**
 * Bridge between the vanilla app and the React spotlight.
 *
 * The spotlight IS the search bar now - it replaces the old LOCATION tray
 * rather than opening over it, so it renders permanently. The component's own
 * markup is a centred full-screen overlay; CSS in tailwind.css moves it to the
 * top and makes its backdrop click-through, so the globe underneath stays
 * draggable.
 */
function SpotlightHost() {
  // The spotlight REPLACES the old LOCATION bar rather than sitting behind a
  // shortcut, so it is always present. `handleClose` is deliberately a no-op:
  // the component calls it when its backdrop is clicked, and a permanent search
  // bar has nothing to close.
  return <AppleSpotlight isOpen handleClose={() => {}} />;
}

let root: Root | null = null;

/**
 * Mount the spotlight overlay into its own container.
 *
 * Its own node, appended to <body>, so React owns a subtree Cesium and the
 * existing UI never touch - the two rendering models stay strictly separated.
 *
 * @returns {void}
 */
export function mountSpotlight(): void {
  if (root) return;
  const container = document.createElement('div');
  container.id = 'spotlight-root';
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(
    <StrictMode>
      <SpotlightHost />
    </StrictMode>,
  );
}
