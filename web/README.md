# Kav for the web

Kav, running in a browser so it works on an iPhone. It's a React app (Vite) and a small Node server
that runs on your own computer. Your phone opens the app over your Wi-Fi.

- **Trip:** plan a trip, see the options, follow one step by step with live departures.
- **Stations:** stops near you or by name or code, with live arrivals and the timetable.
- **Lines:** every line Moovit knows, with its route, stops, buses on the road, departures and alerts.
- **Live:** the stops around you and the vehicles reporting their position.
- **Pay:** pay for bus, train, light rail and Carmelit rides with your own Moovit payment account.

The server does what the Android app does on the phone: it talks to Moovit as Moovit's app does, reads
the Ministry of Transport timetable, and serves the OpenStreetMap map from a file. Nothing goes anywhere
else. Browsers can't call Moovit directly, so this part has to live on a computer.

## Setting it up

You need Node 24 or newer, Python 3 and OpenSSL.

```sh
cd web
./setup.sh     # dependencies, the map (185 MB once), this week's timetable, the app
npm start
```

The server prints two addresses for each network the computer is on, for example:

```
on your iPhone, first time: http://10.0.0.74:8080/   then: https://10.0.0.74:8443/
```

### On the iPhone, once

Safari only shares your location with, and only lets you add to the home screen, a site it trusts. The
server makes its own small certificate authority for this. Its key never leaves the computer.

1. On the iPhone, open the `http://…:8080/` address and download the Kav certificate.
2. **Settings → General → VPN & Device Management** → *Kav local CA* → **Install**.
3. **Settings → General → About → Certificate Trust Settings** → turn on *Kav local CA*.
4. Open the `https://…:8443/` address, then **Share → Add to Home Screen**.

The phone and the computer need to be on the same Wi-Fi. If both run Tailscale, the Tailscale address
works from anywhere.

## Keeping it fresh

The timetable covers one ordinary week. Run `./setup.sh` again every week or two. Live times, trip
plans and line data come from Moovit as you use the app, so they're always current.

## Developing

`npm start` runs the server on :8443. `npm run dev` runs Vite with hot reload and passes `/api` and
`/map` through to it. `npm run typecheck` checks both the app and the server.

| Path | What it is |
| --- | --- |
| `server/moovit.ts` | Moovit's API: sessions, search, trip planning, arrivals, lines (from `Moovit.kt`) |
| `server/pay.ts` | Payments (from `MoovitPay.kt`) |
| `server/net.ts` | The timetable bundle: stop search, nearby stops, departure boards (from `Net.kt`) |
| `server/state.ts` | The two Moovit users (browsing and paying) and learned stop ids, kept in `data/state.json` |
| `server/main.ts` | The HTTPS server, the API routes and the certificates |
| `src/` | The React app |

## Limits compared with the Android app

The web can't do some things the Android app does: the floating window during a trip, the trip in the
notification shade, and reminders while the app is closed. Navigation only follows you while Kav is open
on screen. Kav keeps the screen awake while you navigate.
