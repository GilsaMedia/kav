## 3.3.1: Quick pay pays

- Tapping Pay now on Quick pay, or anywhere on its card, now pays for the bus you scanned, not only opens Kav on paying for it. Kav finds the fare and pays straight away, and the ticket shows when it's done.
- If Kav can't tell your fare (which bus you're on, or where you get off), it asks, and pays as soon as you choose. If it couldn't find where you are, it shows the fare first and waits for you to tap Pay.
- Pay for this bus under "Forgot to pay?" on the Pay screen pays straight away too.

## 3.3: Quick pay on the lock screen

- Scanned a bus's QR code and didn't pay? The lock screen and the Dynamic Island turn to Quick pay: "You scanned a bus at 14:05 and haven't paid yet", with a Pay now button. Tap it, or anywhere on the card, and Kav opens straight on paying for that bus, without scanning again. If no trip was showing there, Quick pay shows on its own.
- Once you pay, or tap Forget it under "Forgot to pay?", Quick pay goes: the trip you had open comes back, or the card is taken off. It also goes 3 hours after the scan, and when Kav is closed.
- Paying from Quick pay while a way is open counts as paying for that way's bus ride, so the fare knows where you get off and the way's own Pay goes too.

## 3.2.1: 3.2 again

- The same app as 3.2, released again. Install it over the Kav you have; your places and settings stay.

## 3.2: the lock screen and the Dynamic Island only while Kav is in use

- A way you open still counts down to its line on the lock screen and in the Dynamic Island, and Start keeps it there for the ride. It's taken off as soon as you stop using it: leaving the way's page, switching to Lines or Settings, pressing Stop, or closing Kav. Nothing is left there once Kav is closed, and a card left over from an earlier run is cleared when Kav opens.
- Pay shows on the lock screen and in the Dynamic Island while the ride ahead isn't paid for, for everyone who pays with Kav. Before, someone who signed in to paying before 3.0 didn't get it until they opened the Pay screen again.
- With SideStore, Kav is told apart from a copy signed with SideStore's "Use Main Profile" more carefully, so it no longer mistakes a working copy for a broken one.

## 3.1.2: Kav says why the Dynamic Island is black

- If Kav was installed without its lock screen part, or with that part signed wrongly, iOS still makes room for the trip in the Dynamic Island but has nothing to draw: it stays black, and the lock screen stays empty. Kav now checks before it starts a trip. If that part is missing or can't run, the way's page and Settings → Lock screen and Dynamic Island → Try it say so, and what to do.
- With SideStore, this happens when SideStore updates a Kav that was first installed without that part: it leaves the part out of every update. The fix is to set App Extensions to "Keep All" in SideStore's settings, then install Kav.ipa again over the one you have. Your places and settings stay.

## 3.1.1: the lock screen and the Dynamic Island show the trip again

- A trip's card on the lock screen and in the Dynamic Island was there but empty: a black island and nothing on the lock screen. The part of Kav that draws them was being stopped by iOS as it started, because of how the app was signed when you installed it. It's signed so that it starts now, and the card shows the trip, the countdown and Pay again.
- Install this version over the one you have, the same way as before. Your places and settings stay.

## 3.1: go anywhere on the map

- Where to (and From, and saving a favourite) has Choose on the map: move the map under the pin and tap Set. The spot under the pin is where you go, no address needed. It's named after the stop nearest it, so it reads well in your recent trips.

## 3.0: pay from the lock screen, and more ways to go

- While a trip is open and the ride ahead isn't paid for yet, the lock screen and the Dynamic Island show a Pay button. It opens Kav straight on paying for that ride, and goes away once you've paid. It's only there while Kav is running, and only if you pay with Kav.
- A way's page counts down to the line you chose before you press Start too: "282 at your stop in 7 min", live when Moovit tracks it, and when to leave for it if there's a walk first.
- Searching for a way shows many more of them: every way Moovit finds instead of its first few, and the ones leaving after them (arriving by a time: arriving before them).
- Paying for a bus lists each bus once. The same line used to show up several times, once for each of its stops nearby.
- The lock screen's countdown names the line you chose, not the first of the lines that can do the ride.

## 2.9.3: every bus shows its number

- Some lines carry a note in their name, such as "390 - בהזמנה מראש" (by advance booking only). Their plate showed just "Bus"; now it shows the number, 390, on the trip, the map and the lock screen.
- The note itself is shown under the line on the trip, so you know before you go that the ride has to be booked.

## 2.9.2: smooth, for real this time

2.9.1 took out the heaviest blur, but the motion itself was still running the slow way on iPhone. Now it runs the way iOS runs its own:

- Every animation (screens sliding in, lists settling, sheets rising, the tab highlight, switches, presses) is handed to iOS to play by itself, off the app's busy thread, as in 2.8. In 2.9 the new spring curves were of a kind iOS can't hand over, so it had to draw each frame alongside everything else the app was doing.
- Letting go of the trip's panel, a sheet, or a Live Directions step is played by iOS too, rather than drawn frame by frame by the app. It still leaves at your finger's speed, still heads where you flicked it, and can still be caught mid-way: it stops right where it is on screen.
- Pulling a sheet down dims what's behind it less as you go, then eases back if you let it stay.

## 2.9.1: smooth again

2.9 could stutter, most of all over the map. This version keeps the new look and motion and takes the weight out:

- Frosted surfaces blur less, and only the few that need it do: the tab bar, sheets, round buttons and Live Directions' card. Chips, the reminder button, the swipe-back arrow and page headers are solid now, so nothing is re-blurred under the map or while you scroll.
- Nothing repaints forever: the ring around your ride on the home screen breathes on its own layer instead of redrawing a shadow every frame.
- Tabs and Live Directions fade in rather than scaling the whole page, and the frequent destination cards no longer resize as you swipe.
- A long list (search results, a line's stops) brings in only its first rows one by one; the rest just appear.
- The trip's panel measures itself only when its size changes, not every time the live times tick.
- Pulling a sheet down dims what's behind it without repainting the screen, and the swipe-back arrow no longer snaps away at the end.

## 2.9: a new look, and motion that moves the way your iPhone does

Kav keeps every screen, tab and button where it was. What changed is how it looks and, above all, how it moves under your finger.

### Moving things by hand

- **The trip's panel** (the steps over the map) stays under your finger as you drag it. When you let go it carries on at your finger's speed: a flick throws it to the height it was heading for, and a slow drag sets it down at the nearest one. Past the top or the bottom it resists more and more, instead of stopping dead. You can catch it while it's still moving, and it stops where it is. A light tap of haptics when it settles at a new height. It now rises into place when a trip opens.
- **Sheets** (when to travel, saving a place, paying) follow your finger down when you pull them, and what's behind them brightens as they go. A quick flick closes one even if it's short, and it leaves at the speed you threw it. Let go early and it springs back.
- **Swiping back from the edge:** the arrow follows your finger, gives a tick when letting go would go back, and a quick flick in from the edge goes back too.
- **Live Directions' steps:** a quick flick turns to the next step even when the swipe is short. A swipe that isn't enough springs back from wherever your finger left it, at its speed, and can be caught again.
- **Reordering** saved places, lines and stops: the row you pick up floats on a deeper shadow, and the others glide out of its way.

### Motion everywhere else

- Everything moves on springs tuned the way Apple tunes them: calm by default, with a little bounce only where something was thrown or lands (the tab highlight, switches, the swap button, the star).
- Buttons, rows and cards answer the moment you touch them (they sink in and light up) and spring back when you let go. Before, iPhone didn't always show the press at all.
- New screens slide in on a spring; pickers rise and leave the way they came; tabs dissolve into each other; lists settle into place one row after another.

### The look

- **Grouped, as on iPhone:** a soft grey page with white cards in Light, and lifted grey cards in Dark and OLED black. Favourites, recent trips, your ride and paying sit in rounded cards with hairlines that start where the text does.
- **Home:** the search is a capsule with a lit search button. Each frequent destination is a card with a wash of your accent colour, and the ones beside it shrink back a little as you swipe. Section titles are bold, with Edit, Add and Clear beside them.
- **Tab bar:** a frosted bar the page shows through, with a highlight that glides to the tab you tap.
- **Segmented controls** (Lines/Stops, language, look, map) have a thumb that slides between choices. **Switches** stretch while held, as iOS's do.
- **Large titles** on the top pages (Settings), tighter type on big text, and countdowns and times in steady figures that don't jump as they change.
- **Trip page:** Start floats on its own glow over the steps; the panel and Live Directions' card are frosted so the map shows through.
- On-time, late and early colours are clearer, and stay readable in Light.

### For people who need it

Kav follows your iPhone's Accessibility settings:

- **Reduce Motion:** nothing slides, springs or bounces; things fade in place, quickly.
- **Reduce Transparency:** the frosted bars, sheets and cards turn solid.
- **Increase Contrast:** clearer edges and darker secondary text.

Nothing else changed: planning, live times, Live Directions, the lock screen, reminders and paying work as they did in 2.8.
