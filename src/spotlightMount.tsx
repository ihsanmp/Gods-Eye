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
import { lookupIdentifier, type LookupResult } from '@/lib/idLookup';
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
    /*
     * A rectangle that covers the planet is not a bias.
     *
     * From high enough up - and the console now opens at 4,200 km -
     * computeViewRectangle returns the whole globe, -90,-180 to 90,180. Sending
     * that tells the server a viewport exists when none usefully does. Better
     * to send nothing and let it answer as an unbiased search.
     */
    const span = Math.abs(rect.east - rect.west) + Math.abs(rect.north - rect.south);
    if (span > Cesium.Math.toRadians(300)) return null;
    return `${parts[0]},${parts[1]}|${parts[2]},${parts[3]}`;
  } catch {
    return null;
  }
}

/** Read a route panel control, which is the one implementation of routing. */
function panelEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Put a value AND its picked coordinates onto one of the panel's fields.
 *
 * Deliberately silent - no `input` event. The panel listens for that to mean a
 * person is typing, and its handler both DELETES the picked coordinates (the
 * text no longer describes them) and opens its own suggestion dropdown. Firing
 * it here would throw away the exact point this bar just resolved, quietly
 * downgrading a precise destination back to a name lookup, and pop a stray
 * list open in a panel nobody is looking at.
 */
function fillPanelField(id: string, text: string, point?: { lat: number; lon: number } | null) {
  const input = panelEl<HTMLInputElement>(id);
  if (!input) return;
  input.value = text;
  if (point) {
    input.dataset.pickedLat = String(point.lat);
    input.dataset.pickedLon = String(point.lon);
  } else {
    delete input.dataset.pickedLat;
    delete input.dataset.pickedLon;
  }
}

interface RouteBarProps {
  destination: GeocodeRow | null;
  onClose: () => void;
}

/**
 * Directions, inside the search bar.
 *
 * This does not route anything itself. Routing lives in the Route panel -
 * origin precedence, the GPS fix and its expiry, cancellation by generation,
 * the road-mix report, the destination cards - and a second copy of that would
 * drift from the first within a week. So the bar fills the panel's own fields
 * and presses its own button, exactly as an operator would.
 *
 * The panel's status line and result block are MOVED here while directions are
 * open, rather than copied. A copy would leave the "BUKA KAMERA" button without
 * its listener; moving a node keeps everything attached to it, and the nodes go
 * home when this closes.
 */
function RouteBar({ destination, onClose }: RouteBarProps) {
  const [origin, setOrigin] = useState('');
  const [dest, setDest] = useState(destination ? destination.label.split(',')[0].trim() : '');
  const [mode, setMode] = useState('car');
  const originPointRef = useRef<{ lat: number; lon: number } | null>(null);
  const destPointRef = useRef<{ lat: number; lon: number } | null>(
    destination ? { lat: destination.lat, lon: destination.lon } : null
  );
  const hostRef = useRef<HTMLDivElement>(null);

  /* Borrow the panel's live status and result nodes for as long as this is up. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const moved: Array<{ node: HTMLElement; parent: Node; next: Node | null }> = [];
    for (const id of ['route-status', 'route-result']) {
      const node = panelEl<HTMLElement>(id);
      if (!node?.parentNode) continue;
      moved.push({ node, parent: node.parentNode, next: node.nextSibling });
      host.appendChild(node);
    }
    return () => {
      for (const { node, parent, next } of moved) parent.insertBefore(node, next);
    };
  }, []);

  const swap = () => {
    const heldOrigin = originPointRef.current;
    originPointRef.current = destPointRef.current;
    destPointRef.current = heldOrigin;
    setOrigin(dest);
    setDest(origin);
  };

  const run = () => {
    fillPanelField('route-origin', origin, originPointRef.current);
    fillPanelField('route-dest', dest, destPointRef.current);
    // The mode buttons are the panel's, so pressing one keeps its own state in
    // step rather than passing a mode the panel does not know it is using.
    panelEl<HTMLButtonElement>('route-panel')
      ?.querySelector<HTMLButtonElement>(`[data-route-mode="${mode}"]`)
      ?.click();
    panelEl<HTMLButtonElement>('route-search-btn')?.click();
  };

  return (
    <div className="gev-routebar">
      <div className="gev-routebar-row">
        <span className="gev-routebar-tag">DARI</span>
        <input
          value={origin}
          placeholder="Titik awal, atau pakai GPS"
          onChange={(event) => { originPointRef.current = null; setOrigin(event.target.value); }}
          onKeyDown={(event) => { if (event.key === 'Enter') run(); }}
        />
        <button
          type="button"
          title="Pakai lokasi saya"
          onClick={() => {
            panelEl<HTMLButtonElement>('route-gps-btn')?.click();
            // The panel writes its own label into its field once the fix lands.
            window.setTimeout(() => {
              const value = panelEl<HTMLInputElement>('route-origin')?.value || '';
              if (value) { originPointRef.current = null; setOrigin(value); }
            }, 1200);
          }}
        >
          GPS
        </button>
        <button type="button" title="Tukar asal dan tujuan" onClick={swap}>&#8645;</button>
      </div>

      <div className="gev-routebar-row">
        <span className="gev-routebar-tag">KE</span>
        <input
          value={dest}
          placeholder="Tujuan"
          onChange={(event) => { destPointRef.current = null; setDest(event.target.value); }}
          onKeyDown={(event) => { if (event.key === 'Enter') run(); }}
        />
      </div>

      <div className="gev-routebar-row gev-routebar-actions">
        {[['car', 'MOBIL'], ['bike', 'SEPEDA'], ['foot', 'JALAN']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-on={mode === id ? 'true' : undefined}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="gev-routebar-go" onClick={run}>CARI RUTE</button>
        <button type="button" onClick={onClose}>TUTUP</button>
      </div>

      <div className="gev-routebar-output" ref={hostRef} />
    </div>
  );
}

/**
 * The card a phone or plate lookup shows in the bar.
 *
 * A flat list of label/value rows with a note stating plainly what is NOT here
 * - the tracking and the owner identity that were asked for and are not
 * lawful to provide. Same slot the route bar uses, so it displaces the place
 * results rather than sitting beside them.
 */
function LookupCard({ result, onClose }: { result: LookupResult; onClose: () => void }) {
  return (
    <div className="gev-lookup">
      <div className="gev-lookup-head">
        <div>
          <div className="gev-lookup-title">{result.title}</div>
          <div className="gev-lookup-subtitle">{result.subtitle}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Tutup">TUTUP</button>
      </div>
      <dl className="gev-lookup-rows">
        {result.rows.map((row) => (
          <div className="gev-lookup-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {result.note ? <div className="gev-lookup-note">{result.note}</div> : null}
    </div>
  );
}

function SpotlightHost() {
  /*
   * Starts as an empty list, never undefined.
   *
   * AppleSpotlight reads `results ?? sampleResults`, so leaving it undefined
   * hands the bar back to the component's own demo rows - Twitter, Safari,
   * Mail. That is what "kafe" showed: not a failed search, a search still in
   * flight, with the demo list standing in for it. A category lookup goes to
   * Overpass and takes tens of seconds, so that window was long enough to look
   * like the answer.
   */
  const [results, setResults] = useState<any[]>([]);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  /** The one search pin currently on the globe, so it can be taken back. */
  const searchMarkRef = useRef<string | null>(null);
  /** The place last chosen from the list - what "route to here" means. */
  const [chosen, setChosen] = useState<GeocodeRow | null>(null);
  const [routeOpen, setRouteOpen] = useState(false);
  /** A phone/plate lookup, shown in place of place results when one matches. */
  const [lookup, setLookup] = useState<LookupResult | null>(null);
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
      // answer was nothing. WHY it was nothing is the part worth passing on -
      // "zoom in" and "nothing of that kind nearby" ask for different things
      // from the operator, and "the search is down" asks for neither.
      const REASONS: Record<string, string> = {
        'category-needs-view': 'Perbesar peta dulu - pencarian kategori mencari di sekitar area yang tampil.',
        'category-empty-nearby': 'Tidak ada yang seperti itu di sekitar area ini.',
        'category-search-unavailable': 'Pencarian kategori sedang tidak bisa dijangkau. Coba lagi sebentar lagi.',
      };
      setEmptyMessage(
        rows.length
          ? null
          : (REASONS[String(data?.reason || '')] || 'Tidak ada tempat yang cocok.'),
      );
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

      /*
       * A phone number or a plate is answered from local tables, not the map.
       *
       * Checked before anything is sent anywhere: these are offline lookups, so
       * the moment the text reads as one there is no reason to geocode it, and
       * every reason not to hand "0812..." to a place search that would list
       * streets whose numbers happen to match. The card displaces the results
       * list the same way directions do.
       */
      const identified = lookupIdentifier(text);
      if (identified) {
        abortRef.current?.abort();
        rowsRef.current = [];
        setResults([]);
        setEmptyMessage(null);
        setLookup(identified);
        return;
      }
      setLookup(null);

      if (text.length < 3) {
        abortRef.current?.abort();
        rowsRef.current = [];
        setResults([]);
        setEmptyMessage(text ? 'Ketik minimal 3 huruf.' : null);
        return;
      }
      /*
       * Retire the previous answer the moment the question changes.
       *
       * Rows left on screen under a new query describe somewhere else, and the
       * bar has no way to say so. Clearing them also lets the searching message
       * through: the component only shows it when the list is empty.
       *
       * A category word ("kafe", "spbu", "supermarket", "tempat makan") is
       * answered by Overpass, which was measured at 13-33 s from this network,
       * so this message is on screen long enough to need to say what is
       * happening rather than just spin.
       */
      rowsRef.current = [];
      setResults([]);
      setEmptyMessage('Mencari di sekitar peta...');
      // /api/geocode is fronted by Nominatim, whose usage policy caps this near
      // one call a second, so a request per keystroke would queue behind itself.
      debounceRef.current = window.setTimeout(() => {
        pendingQueryRef.current = '';
        void search(text);
      }, 400);
    },
    [search]
  );

  /**
   * Drop a pin on the chosen place.
   *
   * Flying the camera alone leaves the operator to work out which of the
   * things now on screen was the answer. The mark says which one, and it
   * stays put while the camera is moved around it.
   *
   * Only ever ONE search pin: the previous is taken back first, so a run of
   * searches does not litter the globe with every place that was passed
   * through on the way to the one that mattered.
   */
  const markSearchResult = useCallback(async (row: GeocodeRow) => {
    const api = (window as any).__godsEyeView?.annotations;
    if (!api?.annotate) return;
    const previous = searchMarkRef.current;
    searchMarkRef.current = null;
    if (previous && api.removeById) api.removeById(previous);
    try {
      const outcome = await api.annotate(
        [{
          type: 'pin',
          label: String(row.label || '').split(',')[0].trim() || 'Hasil pencarian',
          // Red, the colour a map pin is everywhere - and free to use now that
          // the route line has taken blue.
          color: 'red',
          // A point annotation takes its coordinates from the spec itself; the
          // `points` array is for the shapes that have two ends or a path.
          latitude: row.lat,
          longitude: row.lon,
          allowDistant: true
        }],
        { flyTo: false }
      );
      searchMarkRef.current = outcome?.results?.[0]?.id || null;
    } catch {
      // A mark that could not be drawn must not take the camera flight with it.
    }
  }, []);

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
    void markSearchResult(row);
    setChosen(row);
  }, [markSearchResult]);

  /** Take the pin back and forget the place, leaving the bar as it started. */
  const clearChosen = useCallback(() => {
    const api = (window as any).__godsEyeView?.annotations;
    const id = searchMarkRef.current;
    searchMarkRef.current = null;
    if (id && api?.removeById) api.removeById(id);
    setChosen(null);
    setRouteOpen(false);
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
      panel={
        routeOpen ? (
          <RouteBar destination={chosen} onClose={() => setRouteOpen(false)} />
        ) : lookup ? (
          <LookupCard result={lookup} onClose={() => setLookup(null)} />
        ) : chosen ? (
          /*
           * What the reference offers once a place is picked: the place, and
           * the way to it. The description panel it also shows is the one part
           * deliberately left out - this console answers different questions
           * about a destination, and it answers them once a route exists.
           */
          <div className="gev-chosen">
            <span className="gev-chosen-name">{chosen.label.split(',')[0].trim()}</span>
            <button type="button" className="gev-chosen-go" onClick={() => setRouteOpen(true)}>
              RUTE KE SINI
            </button>
            <button type="button" onClick={clearChosen}>HAPUS PENANDA</button>
          </div>
        ) : null
      }
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
