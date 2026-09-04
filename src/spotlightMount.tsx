import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import {
  Building2,
  Coffee,
  Fuel,
  Landmark,
  MapPin,
  Mountain,
  Plane,
  ShoppingBag,
  ShoppingCart,
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

/**
 * The four buttons under the bar: the things you look for while moving.
 *
 * Each is a word the geocoder already understands as a CATEGORY rather than a
 * name - /api/geocode routes those to Overpass and ranks the answers by
 * distance from the centre of the map on screen, because "kafe" is a question
 * about what is around you, not a place called Kafe.
 *
 * "tempat makan" is deliberately the broad one: it resolves to restaurant,
 * fast_food AND food_court, which is what covers everything from a warung to a
 * proper restaurant. Asking for "restoran" alone would resolve to
 * amenity=restaurant and quietly drop the simpler places.
 */
const CATEGORY_SHORTCUTS = [
  { label: 'Tempat makan', query: 'tempat makan', icon: <UtensilsCrossed /> },
  { label: 'SPBU', query: 'spbu', icon: <Fuel /> },
  { label: 'Kafe', query: 'kafe', icon: <Coffee /> },
  { label: 'Supermarket', query: 'supermarket', icon: <ShoppingCart /> }
];

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
  /** The query the debounce is holding, so Enter can run it without waiting. */
  const pendingQueryRef = useRef<string>('');
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
      pendingQueryRef.current = text;
      window.clearTimeout(debounceRef.current);
      if (text.length < 3) {
        abortRef.current?.abort();
        rowsRef.current = [];
        setResults([]);
        setEmptyMessage(text ? 'Ketik minimal 3 huruf.' : null);
        return;
      }
      setEmptyMessage('Mencari...');
      // /api/geocode is fronted by Nominatim, whose usage policy caps this near
      // one call a second, so a request per keystroke would queue behind itself.
      debounceRef.current = window.setTimeout(() => {
        pendingQueryRef.current = '';
        void search(text);
      }, 400);
    },
    [search]
  );

  const flyToRow = useCallback((row: GeocodeRow | undefined) => {
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

  const onSelectResult = useCallback(
    (_result: any, index: number) => flyToRow(rowsRef.current[index]),
    [flyToRow]
  );

  /**
   * Enter goes to the first result.
   *
   * If the debounce has not fired yet - Enter pressed straight after typing,
   * which is the common case - the search is run immediately rather than
   * dropped, so a fast typist is not silently ignored.
   */
  const onSubmit = useCallback(async () => {
    const pending = pendingQueryRef.current;
    if (pending && pending.length >= 3) {
      window.clearTimeout(debounceRef.current);
      await search(pending);
    }
    flyToRow(rowsRef.current[0]);
  }, [flyToRow, search]);

  useEffect(() => () => {
    window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  return (
    <AppleSpotlight
      isOpen
      handleClose={() => {}}
      shortcuts={CATEGORY_SHORTCUTS}
      results={results}
      onSearchChange={onSearchChange}
      onSelectResult={onSelectResult}
      onSubmit={() => { void onSubmit(); }}
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
