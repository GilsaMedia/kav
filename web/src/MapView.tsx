// The offline map: Protomaps tiles served from the Kav server, styled as the Android app styles them.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol, PMTiles } from "pmtiles";
import { T, usePrefs, type LatLon } from "./core.ts";
import { isNative, nativeMapSource, getMapState, subscribeMap, downloadMap, MAP_BYTES } from "./native.ts";

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
// In the app, the map is a file on the phone; in a browser, the server serves it.
if (isNative) protocol.add(new PMTiles(nativeMapSource));
const MAP_SOURCE = () => isNative ? "pmtiles://kav-map" : `pmtiles://${location.origin}/map/israel.pmtiles`;

const styles = new Map<string, Promise<maplibregl.StyleSpecification>>();
function styleFor(light: boolean) {
  const key = light ? "light" : "black";
  if (!styles.has(key)) styles.set(key, fetch(light ? "/map/style-light.json" : "/map/style.json").then(r => r.text()).then(text => {
    const origin = location.origin;
    const s = JSON.parse(text.replace("__MAP__", MAP_SOURCE()).replaceAll("asset://map/", `${origin}/map/`));
    return s;
  }).catch(e => { styles.delete(key); throw e; }));
  return styles.get(key)!;
}

export interface MapLine { coords: LatLon[]; color: string; width?: number; dashed?: boolean; opacity?: number }
export interface MapPoint {
  id: string; at: LatLon; color: string; label?: string; kind: "stop" | "vehicle" | "end" | "user" | "place"; size?: number; ring?: string;
}

interface Props {
  lines?: MapLine[];
  points?: MapPoint[];
  fit?: LatLon[] | null;       // fit these on first show and whenever fitKey changes
  fitKey?: string;
  center?: LatLon | null;
  zoom?: number;
  follow?: LatLon | null;      // keep this point centred
  user?: LatLon | null;
  onPoint?: (id: string) => void;
  onMove?: (center: LatLon, zoom: number) => void;
  className?: string;
}

const lineFeatures = (ls: MapLine[]) => ({
  type: "FeatureCollection" as const,
  features: ls.filter(l => l.coords.length >= 2).map((l, i) => ({
    type: "Feature" as const, id: i,
    properties: { color: l.color, width: l.width ?? 5, dashed: !!l.dashed, opacity: l.opacity ?? 1 },
    geometry: { type: "LineString" as const, coordinates: l.coords.map(([la, lo]) => [lo, la]) },
  })),
});
const pointFeatures = (ps: MapPoint[]) => ({
  type: "FeatureCollection" as const,
  features: ps.map(p => ({
    type: "Feature" as const,
    properties: { id: p.id, color: p.color, label: p.label ?? "", kind: p.kind, size: p.size ?? (p.kind === "vehicle" ? 11 : p.kind === "stop" ? 5 : 8), ring: p.ring ?? "#ffffff" },
    geometry: { type: "Point" as const, coordinates: [p.at[1], p.at[0]] },
  })),
});

export function MapView(props: Props) {
  const state = useSyncExternalStore(subscribeMap, getMapState);
  if (state.k === "ready") return <LiveMap {...props} />;
  return (
    <div className={"map map-missing " + (props.className ?? "")}>
      {state.k === "checking" && <span className="dim">…</span>}
      {(state.k === "missing" || state.k === "failed") && <>
        <div>{T("The map lives on your phone, so no tile server sees where you look.", "המפה נשמרת בטלפון, כך ששום שרת מפות לא רואה איפה אתם מסתכלים.")}</div>
        <button className="btn primary" onClick={downloadMap}>{T(`Download the map (${Math.round(MAP_BYTES / 1e6)} MB, once)`, `הורדת המפה (${Math.round(MAP_BYTES / 1e6)} MB, פעם אחת)`)}</button>
        {state.k === "failed" && <div className="small" style={{ color: "var(--critical)" }}>{state.why}</div>}
      </>}
      {state.k === "downloading" && <>
        <div>{T("Downloading the map…", "מורידים את המפה…")} {Math.round(state.progress * 100)}%</div>
        <div className="progress"><div style={{ width: `${state.progress * 100}%` }} /></div>
        <div className="dim small">{T("Keep Kav open until it finishes.", "השאירו את Kav פתוחה עד שההורדה תסתיים.")}</div>
      </>}
    </div>
  );
}

// Building a map is slow on a phone (the style, the fonts, every tile read through the bridge), so maps
// are kept and handed from screen to screen instead of being thrown away: going back to a screen or
// switching tabs shows the map as it was, tiles and all.
interface Owner { onPoint?: (id: string) => void; onMove?: (center: LatLon, zoom: number) => void }
interface Pooled { m: maplibregl.Map; div: HTMLDivElement; light: boolean; loaded: Promise<void>; owner: Owner | null }
const pool: Pooled[] = [];
const POOL_MAX = 3;

async function acquire(light: boolean, host: HTMLElement, owner: Owner, center: LatLon | null | undefined, zoom: number): Promise<Pooled> {
  const free = pool.find(p => !p.owner && p.light === light);
  if (free) {
    free.owner = owner;
    host.appendChild(free.div);
    free.m.resize();
    return free;
  }
  const style = await styleFor(light);
  const div = document.createElement("div");
  div.className = "map-canvas";
  host.appendChild(div);
  const m = new maplibregl.Map({
    container: div, style, attributionControl: false,
    center: center ? [center[1], center[0]] : [34.7818, 32.0853], zoom: center ? zoom : 11,
    maxBounds: [[33.5, 29.0], [36.6, 33.7]], dragRotate: false, pitchWithRotate: false, fadeDuration: 0,
  });
  const p: Pooled = { m, div, light, owner, loaded: Promise.resolve() };
  m.touchZoomRotate.disableRotation();
  m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "© OpenStreetMap" }), "bottom-left");
  p.loaded = new Promise(done => m.on("load", () => {
    m.addSource("kav-lines", { type: "geojson", data: lineFeatures([]) });
    m.addSource("kav-points", { type: "geojson", data: pointFeatures([]) });
    m.addLayer({ id: "kav-line-casing", type: "line", source: "kav-lines", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": light ? "#ffffff" : "#000000", "line-width": ["+", ["get", "width"], 3], "line-opacity": ["*", 0.6, ["get", "opacity"]] } });
    m.addLayer({ id: "kav-line", type: "line", source: "kav-lines", filter: ["!", ["get", "dashed"]], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": ["get", "opacity"] } });
    m.addLayer({ id: "kav-line-dashed", type: "line", source: "kav-lines", filter: ["get", "dashed"], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-dasharray": [0.1, 2], "line-opacity": ["get", "opacity"] } });
    m.addLayer({ id: "kav-point", type: "circle", source: "kav-points",
      paint: { "circle-color": ["get", "color"], "circle-radius": ["get", "size"], "circle-stroke-color": ["get", "ring"], "circle-stroke-width": ["match", ["get", "kind"], "stop", 1.5, 2.5] } });
    m.addLayer({ id: "kav-label", type: "symbol", source: "kav-points", filter: ["==", ["get", "kind"], "vehicle"],
      layout: { "text-field": ["get", "label"], "text-font": ["NotoMedium"], "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff" } });
    // The names of stops on the way, once close enough in to read them.
    m.addLayer({ id: "kav-way-label", type: "symbol", source: "kav-points", filter: ["all", ["==", ["get", "kind"], "stop"], ["!=", ["get", "label"], ""]], minzoom: 14.5,
      layout: { "text-field": ["get", "label"], "text-font": ["NotoMedium"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-max-width": 9 },
      paint: { "text-color": light ? "#55555C" : "#B4B4BC", "text-halo-color": light ? "#ffffff" : "#000000", "text-halo-width": 1.2 } });
    m.addLayer({ id: "kav-stop-label", type: "symbol", source: "kav-points", filter: ["==", ["get", "kind"], "end"], minzoom: 12,
      layout: { "text-field": ["get", "label"], "text-font": ["NotoMedium"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-max-width": 10 },
      paint: { "text-color": light ? "#16161A" : "#F5F5F7", "text-halo-color": light ? "#ffffff" : "#000000", "text-halo-width": 1.5 } });
    for (const layer of ["kav-point", "kav-label"]) {
      m.on("click", layer, e => { const id = e.features?.[0]?.properties?.id; if (id) p.owner?.onPoint?.(String(id)); });
      m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
    }
    // Only moves the person made: the map following them or fitting a route isn't a reason to search again.
    m.on("moveend", e => { if (!(e as { originalEvent?: unknown }).originalEvent) return; const c = m.getCenter(); p.owner?.onMove?.([c.lat, c.lng], m.getZoom()); });
    done();
  }));
  // A map on a hidden tab has no size until the tab shows again.
  new ResizeObserver(() => { if (div.isConnected) m.resize(); }).observe(div);
  pool.push(p);
  return p;
}

function release(p: Pooled) {
  p.owner = null;
  p.m.stop();
  p.loaded.then(() => {
    if (p.owner) return;
    (p.m.getSource("kav-lines") as maplibregl.GeoJSONSource | undefined)?.setData(lineFeatures([]));
    (p.m.getSource("kav-points") as maplibregl.GeoJSONSource | undefined)?.setData(pointFeatures([]));
  });
  p.div.remove();
  // Keep a few; more than that is memory a phone would rather have back.
  const spare = pool.filter(x => !x.owner);
  if (spare.length > POOL_MAX) {
    const old = spare[0];
    pool.splice(pool.indexOf(old), 1);
    old.m.remove();
  }
}

function LiveMap({ lines = [], points = [], fit, fitKey, center, zoom = 14, follow, user, onPoint, onMove, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const { look } = usePrefs();
  const light = look === "light";
  const owner = useRef<Owner>({});
  owner.current.onPoint = onPoint;
  owner.current.onMove = onMove;

  useEffect(() => {
    let gone = false, held: Pooled | null = null;
    acquire(light, el.current!, owner.current, center, zoom).then(async p => {
      held = p;
      if (gone) { release(p); return; }
      await p.loaded;
      if (gone) return;
      map.current = p.m;
      setReady(true);
    }).catch(() => { /* no style: the map stays empty until it's shown again */ });
    return () => { gone = true; setReady(false); map.current = null; if (held) release(held); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light]);

  const allPoints = user ? [...points, { id: "__user", at: user, color: "#4A90FF", kind: "user" as const, size: 7 }] : points;
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    (m.getSource("kav-lines") as maplibregl.GeoJSONSource).setData(lineFeatures(lines));
    (m.getSource("kav-points") as maplibregl.GeoJSONSource).setData(pointFeatures(allPoints));
  });

  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current; if (!m || !ready || !fit || fit.length === 0) return;
    const key = fitKey ?? "once";
    if (fitted.current === key) return;
    fitted.current = key;
    if (fit.length === 1) { m.jumpTo({ center: [fit[0][1], fit[0][0]], zoom: 15 }); return; }
    const b = new maplibregl.LngLatBounds();
    for (const [la, lo] of fit) b.extend([lo, la]);
    m.fitBounds(b, { padding: 48, maxZoom: 16, duration: 0 });
  }, [ready, fit, fitKey]);

  useEffect(() => {
    const m = map.current; if (!m || !ready || !follow) return;
    m.easeTo({ center: [follow[1], follow[0]], duration: 600 });
  }, [ready, follow?.[0], follow?.[1]]);

  // The first centre sets the zoom too; later ones glide there and leave the zoom as the person left it.
  const centred = useRef(false);
  useEffect(() => {
    const m = map.current; if (!m || !ready || !center) return;
    if (!centred.current) { centred.current = true; m.jumpTo({ center: [center[1], center[0]], zoom }); return; }
    m.easeTo({ center: [center[1], center[0]], duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, center?.[0], center?.[1]]);

  return <div ref={el} className={"map " + (className ?? "")} />;
}
