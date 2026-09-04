import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useEffect, useState } from 'react';
import { AppleSpotlight } from '@/components/ui/apple-spotlight';
import '@/tailwind.css';

/**
 * Bridge between the vanilla app and the React spotlight.
 *
 * AppleSpotlight is a full-screen overlay, not an inline field, so it is opened
 * rather than embedded: Ctrl/Cmd-K, or clicking the existing top-centre search
 * bar. Escape and a click on the backdrop close it. Both entry points are
 * wired here so the rest of the app needs to know nothing about React.
 */
function SpotlightHost() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((open) => !open);
        return;
      }
      if (event.key === 'Escape') setIsOpen(false);
    };

    // Clicking the existing search field opens the overlay instead. The vanilla
    // bar stays in place as the affordance; the spotlight is what it opens.
    const onSearchClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.('#location-search, .search-toggle-btn')) return;
      event.preventDefault();
      setIsOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onSearchClick, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onSearchClick, true);
    };
  }, []);

  return <AppleSpotlight isOpen={isOpen} handleClose={() => setIsOpen(false)} />;
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
