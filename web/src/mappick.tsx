// Choosing a place by where it is rather than by its address: the map moves under a pin in its middle, and the
// spot under the pin is the place. Named after the stop nearest it, so it reads in recent trips.
import { useState } from "react";
import { T, api, useLoad, distanceText, currentHere, type LatLon, type Place } from "./core.ts";
import { Header, useLeaving } from "./ui.tsx";
import { MapView } from "./MapView.tsx";
import { PinGlyph } from "./icons.tsx";

interface NearStop { name: string; city: string; metres?: number }

// Where the map opens without a location: the middle of Tel Aviv.
const SOMEWHERE: LatLon = [32.0853, 34.7818];

export function MapPicker({ onPick, onClose }: { onPick: (p: Place) => void; onClose: () => void }) {
  const [start] = useState<LatLon>(() => currentHere() ?? SOMEWHERE);
  const [at, setAt] = useState<LatLon>(start);
  const [leaving, leave] = useLeaving(onClose, 240);
  // The stop nearest the pin, asked again once the map has settled somewhere new.
  const key = `${at[0].toFixed(4)},${at[1].toFixed(4)}`;
  const near = useLoad<{ stops: NearStop[] }>(`pin:${key}`, s => new Promise(r => setTimeout(r, 250))
    .then(() => api(`stations/near?lat=${at[0]}&lon=${at[1]}`, undefined, s)), undefined, true);
  const stop = near.data?.stops.find(x => (x.metres ?? Infinity) < 400);
  const coords = `${at[0].toFixed(5)}, ${at[1].toFixed(5)}`;
  const name = stop ? T(`Near ${stop.name}`, `ליד ${stop.name}`) : coords;

  return (
    <div className={"overlay" + (leaving ? " leaving" : "")}>
      <Header title={T("Choose on the map", "בחירה במפה")} back={leave} />
      <div className="pick-map">
        <MapView className="map-full" center={start} zoom={16} user={currentHere()} onMove={c => setAt(c)} />
        {/* The pin stays in the middle; its point is the spot chosen. */}
        <span className="pick-pin" aria-hidden="true"><PinGlyph size={40} /></span>
        <div className="pick-card card">
          <div className="grow">
            <b dir="auto">{name}</b>
            <div className="dim small">{stop ? <>{distanceText(stop.metres!)} · <span className="ltr">{coords}</span></> : T("Move the map to put the pin where you're going.", "הזיזו את המפה כדי לשים את הסיכה איפה שאתם רוצים.")}</div>
          </div>
          <button className="btn primary" onClick={() => onPick({ name, detail: T("Chosen on the map", "נבחר במפה"), lat: at[0], lon: at[1] })}>
            {T("Set", "בחירה")}
          </button>
        </div>
      </div>
    </div>
  );
}
