<p align="center">
  <img src=".github/icon.png" width="112" alt="Kav">
</p>

<h1 align="center">Kav</h1>

<p align="center">
  Public transport in Israel, without the ads, the account or the tracking.
</p>

<p align="center">
  <a href="https://github.com/ImNoammm/kav/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/ImNoammm/kav?label=release&color=9ABEFF"></a>
  <img alt="Android 8.0 or newer" src="https://img.shields.io/badge/Android-8.0%2B-3DDC84?logo=android&logoColor=white">
  <a href="LICENSE"><img alt="GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-lightgrey"></a>
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/Noamm"><img alt="Buy Me A Coffee" src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png"></a>
</p>

## Install on iPhone

This branch has Kav as an iPhone app too. It works on its own: no computer, no
account, no App Store. You install it with your own Apple ID.

**1. Download the app**

1. Open [Actions → iOS app](https://github.com/GilsaMedia/kav/actions/workflows/ios.yml)
   (sign in to GitHub first).
2. Click the newest run with a green ✓.
3. At the bottom, under **Artifacts**, click **Kav-ipa**.
4. Unzip the download. Inside is `Kav.ipa`.

**2. Put it on your iPhone with [Sideloadly](https://sideloadly.io)** (Mac or Windows)

1. Install Sideloadly and open it.
2. Connect the iPhone with a cable. Unlock it and tap **Trust This Computer** if it asks.
3. Drag `Kav.ipa` into Sideloadly.
4. Type your Apple ID email and press **Start**, then your Apple ID password when
   asked. A free Apple ID is fine. Sideloadly sends it only to Apple, to sign the app.
5. Wait for **Done**.

**3. Allow it on the iPhone**

1. **Settings → General → VPN & Device Management** → tap your Apple ID → **Trust**.
2. On iOS 16 or newer: **Settings → Privacy & Security → Developer Mode** → on.
   The phone restarts; confirm **Turn On** afterwards.
3. Open **Kav**. Allow location when it asks, and tap **Download the map**
   (185 MB, once; Wi-Fi is best).

**Every 7 days**

A free Apple ID signs apps for 7 days. When Kav stops opening, repeat step 2 with
the same `Kav.ipa` (or a newer one). Your places and settings stay.
[AltStore](https://altstore.io) can renew it for you over Wi-Fi instead.

**With a Mac and Xcode** you can skip the download: see
[web/README.md](web/README.md#the-iphone-app).

An Android app for getting around on public transport in Israel. No ads, no
account, no analytics, nothing phoning home about where you go. Hebrew and
English, and it lays itself out right to left when you pick Hebrew.

I built it because Moovit is the only app that really covers Israeli transit and
it has become unusable: full-screen ads, a subscription nag, and a permissions
list that has nothing to do with catching a bus. Kav is the same job done
plainly: it plans a trip, tells you which bus, and walks you through it while
you're on the way.

## What it does

- Plans a trip, gives you a few ways there, and walks you through the one you
  pick. The step moves on by itself as you walk and ride, the map turns with
  you, and if you leave the app the current step follows you in a small
  floating window.
- Shows where your bus actually is. The trip stays in the notification shade
  while you're on the way, and on Android 16 it shows up as a live update.
- A live screen with every stop around you and the buses reporting their
  position.
- Departure boards for every station, and a page for every line with its route
  on a map, its stops and its buses on the road.
- OLED black, light and dark, with liquid glass or solid bars.
- Favourite places on the home screen, and backups of your places and settings
  to a `.kav` file.
- Private search, on by default, keeps your exact location out of searches:
  Moovit only sees the centre of the town you're in, or a place you pick.
- Pays for bus, train, light rail and Carmelit rides, if you want it to. That
  needs your own Moovit payment account, and only payments use it. Everything
  else stays anonymous.

## Getting it

Grab the APK from [Releases](https://github.com/ImNoammm/kav/releases) and open
it. It updates itself from the same page. No store, no update service.

First launch fetches the map, about 176 MB once. It lives on the phone from then
on, so the map works offline and no tile server sees where you look.

## On the web (iPhone)

[`web/`](web/README.md) runs Kav in a browser: a React app and a small server on your own
computer, so it works on an iPhone too.

## Building it

You need a JDK and the Android SDK. There's a script that fetches both into
`~/Android` without touching your system packages:

```sh
tools/android_toolchain.sh
tools/android_build.sh :app:assembleRelease
```

The timetable isn't in the repo. The Ministry of Transport publishes its GTFS
feed with no licence attached, so build it yourself:

```sh
tools/fetch.sh
KAV_REGION=il KAV_BBOX=national python3 tools/export_web_bundle.py
```

## Credits

- Map data © OpenStreetMap contributors, from the Protomaps build, drawn with
  MapLibre.
- The liquid glass shaders come from Kyant0's
  [AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) (Apache
  License 2.0).
- Timetables from the Israel Ministry of Transport. Trip plans and live
  positions from Moovit.

## License

GPL-3.0. See [LICENSE](LICENSE).
