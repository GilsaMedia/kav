// Every stop around you and the vehicles reporting their position, refreshed as Moovit asks.
import { useRef, useState } from "react";
import { T, api, useHere, useLoad, useNow, minutesText, timeOf, isLive, modeColor, mergeResolved, emptyResolved, type Arrival, type Resolved, type LatLon } from "../core.ts";
import { Header, LineBadge, Spinner, Note, LiveDot } from "../ui.tsx";
import { MapView, type MapPoint } from "../MapView.tsx";

interface LiveStop { id: number; name: string; lat: number; lon: number; code: number }
interface LiveData { stops: LiveStop[]; arrivals: Arrival[]; poll: number; pending: number; resolved: Resolved }

const TLV: LatLon = [32.0759, 34.7745];

export function LiveScreen() {
  const here = useHere();
  const [look, setLook] = useState<LatLon | null>(null);
  const [focus, setFocus] = useState<{ kind: "vehicle"; trip: string } | { kind: "stop"; id: number } | null>(null);
  const centre = look ?? here ?? TLV;
  // Round the centre so small drags don't start a new search.
  const key = `${centre[0].toFixed(3)},${centre[1].toFixed(3)}`;
  const poll = useRef(20);
  const resolvedAll = useRef<Resolved>(emptyResolved());
  const live = useLoad<LiveData>(key, s => api<LiveData>(`live?lat=${centre[0]}&lon=${centre[1]}&km=1.2`, undefined, s).then(r => {
    // While stops are still being matched to Moovit's, ask again sooner.
    poll.current = r.pending > 0 ? 6 : Math.min(Math.max(r.poll, 10), 60);
    resolvedAll.current = mergeResolved(resolvedAll.current, r.resolved);
    return r;
  }), () => poll.current * 1000);
  const now = useNow(5000);
  const r = resolvedAll.current;
  const typeOf = (lineId: number) => { const l = r.lines[lineId]; return l ? r.routeTypes[l.agencyId] ?? 3 : 3; };

  const arrivals = live.data?.arrivals ?? [];
  const byTrip = new Map<string, Arrival>();
  for (const a of arrivals) {
    if (!a.tracked || !a.lat) continue;
    const k = String(a.tripId); const p = byTrip.get(k);
    if (!p || timeOf(a) < timeOf(p)) byTrip.set(k, a);
  }
  const vehicles = [...byTrip.values()].sort((a, b) => timeOf(a) - timeOf(b));
  const stops = live.data?.stops ?? [];
  const stopById = new Map(stops.map(s => [s.id, s]));

  const focusVehicle = focus?.kind === "vehicle" ? byTrip.get(focus.trip) : undefined;
  const focusStop = focus?.kind === "stop" ? stopById.get(focus.id) : undefined;
  const pattern = useLoad<{ stops: { id: number; name: string; lat: number | null; lon: number | null }[] }>(
    focusVehicle && focusVehicle.patternId > 0 ? `pat:${focusVehicle.patternId}` : null,
    s => api(`pattern?id=${focusVehicle!.patternId}`, undefined, s));
  const shape = useLoad<{ shape: LatLon[] }>(focusVehicle && focusVehicle.tripShapeId > 0 ? `shape:${focusVehicle.tripShapeId}` : null,
    s => api(`shape?id=${focusVehicle!.tripShapeId}`, undefined, s));

  const points: MapPoint[] = [
    ...stops.map(s => ({ id: `s${s.id}`, at: [s.lat, s.lon] as LatLon, color: focusStop?.id === s.id ? "#9ABEFF" : "#ffffff", kind: "stop" as const, ring: "#555", size: focusStop?.id === s.id ? 8 : 5 })),
    ...(focusVehicle ? (pattern.data?.stops ?? []).filter(s => s.lat != null).map(s => ({ id: `p${s.id}`, at: [s.lat!, s.lon!] as LatLon, color: "#ffffff", kind: "stop" as const, ring: modeColor(typeOf(focusVehicle.lineId)) })) : []),
    ...vehicles.map(v => ({ id: `v${v.tripId}`, at: [v.lat, v.lon] as LatLon, color: modeColor(typeOf(v.lineId)), kind: "vehicle" as const,
      label: r.lines[v.lineId]?.number ?? "", size: focusVehicle && String(focusVehicle.tripId) === String(v.tripId) ? 15 : 11 })),
  ];
  const lines = focusVehicle && shape.data?.shape.length ? [{ coords: shape.data.shape, color: modeColor(typeOf(focusVehicle.lineId)), width: 5, opacity: 0.85 }] : [];

  const onPoint = (id: string) => {
    if (id.startsWith("v")) setFocus({ kind: "vehicle", trip: id.slice(1) });
    else if (id.startsWith("s")) setFocus({ kind: "stop", id: Number(id.slice(1)) });
  };

  const list = focusStop
    ? arrivals.filter(a => a.stopId === focusStop.id && timeOf(a) >= now - 60).sort((a, b) => timeOf(a) - timeOf(b))
    : vehicles;

  return (
    <div className="screen">
      <Header title={T("Live", "בזמן אמת")} sub={
        live.data ? (vehicles.length ? T(`${vehicles.length} live vehicles · ${stops.length} stops`, `${vehicles.length} כלי רכב · ${stops.length} תחנות`) : T("No tracked vehicles right now", "אין כרגע כלי רכב במעקב"))
          : T("Positions come from Moovit", "המיקומים מגיעים מ-Moovit")} />
      <MapView className="map-half" points={points} lines={lines} user={here} center={look ? null : key.split(",").map(Number) as LatLon} zoom={15}
        onPoint={onPoint} onMove={c => { if (!here || Math.abs(c[0] - centre[0]) + Math.abs(c[1] - centre[1]) > 0.004) setLook(c); }} />
      <div className="pad stack">
        {live.loading && !live.data && <Spinner text={T("Finding the stops around you…", "מחפשים את התחנות סביבכם…")} />}
        {live.error && <Note tone="warn">{live.error}</Note>}
        {live.data && live.data.pending > 0 && <div className="dim small">{T(`Matching ${live.data.pending} more stops…`, `מתאימים עוד ${live.data.pending} תחנות…`)}</div>}
        {look && here && <button className="link" onClick={() => setLook(null)}>◎ {T("Back to my location", "חזרה למיקום שלי")}</button>}
        {focus && (
          <div className="focus-head">
            <button className="link" onClick={() => setFocus(null)}>✕</button>
            {focusStop && <b dir="auto">{focusStop.name}</b>}
            {focusVehicle && <><LineBadge number={r.lines[focusVehicle.lineId]?.number ?? "…"} type={typeOf(focusVehicle.lineId)} />
              <span dir="auto">{T("to", "ל")}{r.lines[focusVehicle.lineId]?.destination ?? ""}</span></>}
          </div>
        )}
      </div>
      <div className="scroll">
        <ul className="list">
          {list.slice(0, 80).map(a => {
            const line = r.lines[a.lineId];
            const away = a.nextStopIndex >= 0 && a.stopIndex >= a.nextStopIndex ? a.stopIndex - a.nextStopIndex : -1;
            return (
              <li key={`${a.tripId}:${a.stopId}`} className="row" onClick={() => a.tracked && setFocus({ kind: "vehicle", trip: String(a.tripId) })}>
                <LineBadge number={line?.number ?? "…"} type={typeOf(a.lineId)} />
                <div className="row-main">
                  <div dir="auto">{line?.destination ? `${T("to", "ל")}${line.destination}` : ""}</div>
                  <div className="dim small" dir="auto">{stopById.get(a.stopId)?.name ?? ""}{away > 0 ? T(` · ${away} stops away`, ` · עוד ${away} תחנות`) : away === 0 ? T(" · at the stop", " · בתחנה") : ""}</div>
                </div>
                <span className={"dep" + (isLive(a) ? " live" : "")}>{isLive(a) && <LiveDot />}{minutesText(Math.round((timeOf(a) - now) / 60))}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
