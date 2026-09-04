import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import {
  Building2,
  Landmark,
  MapPin,
  Mountain,
  Plane,
  ShoppingBag,
  Train,
  Trees,
  UtensilsCrossed
} from 'lucide-react';
import { AppleSpotlight } from '@/components/ui/apple-spotlight';
import '@/tailwind.css';

/**
 * Bridge between the vanilla app and the React spotlight.
 *
 * The spotlight IS the search bar - it replaced the old LOCATION tray rather
 * than opening over it, so it renders permanently. The component's own markup
 * is a centred full-screen overlay; CSS in tailwind.css moves it to the top and
 * makes its backdrop click-through, so the globe underneath stays draggable.
 *
 * The results are live places from /api/geocode, biased to the viewport. The
 * four shortcut buttons keep the component's own defaults.
 */

interface GeocodeRow {
  lat: number;
  lon: number;
  label: string;
  osmType?: string;
}

/** Category icon from the OSM type, defaulting to a map pin. */
function iconFor(osmType: string | undefined) {
  const type = String(osmType || '').toLowerCase();
  if (/station|halt|railway/.test(type)) return <Train />;
  if (/aerodrome|airport/.test(type)) return <Plane />;
  if (/mall|shop|supermarket|retail|marketplace/.test(type)) return <ShoppingBag />;
  if (/restaurant|cafe|fast_food|food/.test(type)) return <UtensilsCrossed />;
  if (/peak|volcano|ridge|mountain/.test(type)) return <Mountain />;
  if (/park|forest|nature/.test(type)) return <Trees />;
  if (/museum|monument|memorial|historic|attraction/.test(type)) return <Landmark />;
  if (/city|town|village|municipality|suburb|county|state/.test(type)) return <Building2 />;
  return <MapPin />;
}

/** The viewport box the geocoder ranks against, in the app's own bias format. */
function viewportBias(viewer: any): string | null {
  try {
    const rect = viewer?.camera?.computeViewRectangle?.();
    if (!rect) return null;
    const parts = [
      Cesium.Math.toDegrees(rect.south).toFixed(4),
      Cesium.Math.toDegrees(rect.west).toFixed(4),
      Cesium.Math.toDegrees(rect.north).toFixed(4),
      Cesium.Math.toDegrees(rect.east).toFixed(4)
    ];
    if (parts.some((value) => value === 'NaN')) return null;
    return `${parts[0]},${parts[1]}|${parts[2]},${parts[3]}`;
  } catch {
    return null;
  }
}

function SpotlightHost() {
  const [results, setResults] = useState<any[] | undefined>(undefined);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const rowsRef = useRef<GeocodeRow[]>([]);
  const debounceRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (text: string) => {
    const viewer = (window as any).__godsEyeView?.viewer;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const bias = viewportBias(viewer);
    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(text)}${bias ? `&bias=${encodeURIComponent(bias)}` : ''}`,
        { signal: abortRef.current.signal }
      );
      if (!response.ok) {
        setResults([]);
        setEmptyMessage('Pencarian tidak tersedia.');
        return;
      }
      const data = await response.json();
      const rows: GeocodeRow[] = (data?.results || []).filter(
        (row: GeocodeRow) => Number.isFinite(row.lat) && Number.isFinite(row.lon)
      );
      rowsRef.current = rows;
      setResults(
        rows.slice(0, 8).map((row) => {
          const parts = String(row.label || '').split(',').map((part) => part.trim());
          return {
            icon: iconFor(row.osmType),
            label: parts[0] || text,
            // Enough address to tell same-named places apart, which is the
            // whole reason a list is shown rather than one answer.
            description: parts.slice(1, 4).join(', '),
            link: '#'
          };
        })
      );
      // An honest empty beats a stale list: the geocoder answered, and the
      // answer was nothing.
      setEmptyMessage(rows.length ? null : 'Tidak ada tempat yang cocok.');
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      setResults([]);
      setEmptyMessage('Pencarian gagal. Periksa koneksi.');
    }
  }, []);

  const onSearchChange = useCallback(
    (value: string) => {
      const text = value.trim();
      window.clearTimeout(debounceRef.current);
      if (text.length < 3) {
        abortRef.current?.abort();
        setResults([]);
        setEmptyMessage(text ? 'Ketik minimal 3 huruf.' : null);
        return;
      }
      setEmptyMessage('Mencari...');
      // /api/geocode is fronted by Nominatim, whose usage policy caps this near
      // one call a second, so a request per keystroke would queue behind itself.
      debounceRef.current = window.setTimeout(() => { void search(text); }, 400);
    },
    [search]
  );

  const onSelectResult = useCallback((_result: any, index: number) => {
    const row = rowsRef.current[index];
    const viewer = (window as any).__godsEyeView?.viewer;
    if (!row || !viewer) return;
    // Fly to the chosen row's OWN coordinates rather than re-geocoding its
    // text, so the camera lands where the row said it would.
    const wide = /city|town|village|municipality|county|state|region/i.test(row.osmType || '');
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(row.lon, row.lat, wide ? 30000 : 2500),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-60), roll: 0 },
      duration: 2.4
    });
  }, []);

  useEffect(() => () => {
    window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  return (
    <AppleSpotlight
      isOpen
      handleClose={() => {}}
      results={results}
      onSearchChange={onSearchChange}
      onSelectResult={onSelectResult}
      emptyMessage={emptyMessage}
    />
  );
}

let root: Root | null = null;

/**
 * Mount the spotlight into its own container.
 *
 * Its own node, appended to <body>, so React owns a subtree Cesium and the
 * existing UI never touch - the two rendering models stay strictly separated.
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
    </StrictMode>
  );
}
