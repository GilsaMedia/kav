# Kav for iPhone and the web

Kav's Android app, remade as a React app (Vite). It runs two ways:

- **As an iPhone app** (`ios/`, built with Capacitor): standalone. The app talks to Moovit itself,
  carries the timetable, and downloads the map once. No computer needed.
- **In a browser**, served by a small Node server on your own computer (`server/`).

Both run the same backend code (`backend/`).

- **Trip:** plan a trip, see the options, follow one step by step with live departures.
- **Stations:** stops near you or by name or code, with live arrivals and the timetable.
- **Lines:** every line Moovit knows, with its route, stops, buses on the road, departures and alerts.
- **Live:** the stops around you and the vehicles reporting their position.
- **Pay:** pay for bus, train, light rail and Carmelit rides with your own Moovit payment account.

The server does what the Android app does on the phone: it talks to Moovit as Moovit's app does, reads
the Ministry of Transport timetable, and serves the OpenStreetMap map from a file. Nothing goes anywhere
else. Browsers can't call Moovit directly, so this part has to live on a computer.

## The iPhone app

### Getting the IPA

GitHub builds it on every push to the `ios` branch: open the repository's **Actions** tab → **iOS
app** → the newest run → **Artifacts** → **Kav-ipa**, and unzip it to get `Kav.ipa`. To build a new one
with the latest timetable, push any change to `ios`.

On a Mac you can build it yourself too:

```sh
cd web
./setup.sh            # the timetable (and the map, for the browser version)
npm run build:ios     # the web part, the map style and the timetable, into the Xcode project
open ios/App/App.xcodeproj
```

In Xcode, choose your iPhone at the top, pick your Apple ID under **Signing & Capabilities → Team**,
and press **Run**.

### Installing it with a free Apple ID

The IPA isn't signed: it's signed on the way onto your phone with your own Apple ID.

- **Sideloadly** (Mac or Windows): connect the iPhone with a cable, drop `Kav.ipa` in, enter your Apple
  ID and press **Start**.
- **AltStore**: add `Kav.ipa` from the My Apps tab. AltStore renews the app by itself over Wi-Fi.

Then, on the iPhone: **Settings → General → VPN & Device Management** → your Apple ID → **Trust**. On
iOS 16 and later, also turn on **Settings → Privacy & Security → Developer Mode** and restart.

With a free Apple ID an app runs for **7 days**, then has to be installed again (Sideloadly) or
refreshed (AltStore does it for you). Your places and settings stay.

On first launch, Kav offers to download the map (185 MB, once, over Wi-Fi is best).

## The browser version

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
| `backend/moovit.ts` | Moovit's API: sessions, search, trip planning, arrivals, lines (from `Moovit.kt`) |
| `backend/pay.ts` | Payments (from `MoovitPay.kt`) |
| `backend/net.ts` | The timetable bundle: stop search, nearby stops, departure boards (from `Net.kt`) |
| `backend/state.ts` | The two Moovit users (browsing and paying) and learned stop ids |
| `backend/routes.ts` | The API the screens call |
| `server/main.ts` | The browser version's HTTPS server and certificates |
| `src/native.ts` | The iPhone app's side: the backend on the phone, the map file |
| `ios/App/App/KavNative.swift` | Moovit's requests, the map download and reads, keeping the screen on |
| `src/` | The React app |

## Limits compared with the Android app

Neither version has the floating window during a trip, the trip in the notification shade, or reminders
while the app is closed. Navigation follows you while Kav is open on screen, and keeps the screen awake
while it does.
