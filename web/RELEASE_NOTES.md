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
