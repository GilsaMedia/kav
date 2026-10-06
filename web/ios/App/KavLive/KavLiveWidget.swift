import ActivityKit
import SwiftUI
import WidgetKit

// The trip on the lock screen and in the Dynamic Island, laid out as Moovit's: what to do now, a track
// of the whole trip that fills as it goes, and a live countdown the system keeps running with Kav asleep.
@main
struct KavLiveBundle: WidgetBundle {
    var body: some Widget {
        KavTripLive()
    }
}

struct KavTripLive: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KavTripAttributes.self) { ctx in
            LockScreen(s: ctx.state, destination: ctx.attributes.destination, stale: ctx.isStale)
                .activityBackgroundTint(Color(white: 0.12).opacity(0.86))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { ctx in
            let s = ctx.state
            let stale = ctx.isStale
            let accent = Color(hex: s.accent)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    PhaseBadge(s: s, size: 44).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    When(s: s, size: 24, stale: stale).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                        Text(s.detail).font(.caption).foregroundColor(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Track(s: s).padding(.horizontal, 6).padding(.top, 4)
                }
            } compactLeading: {
                PhaseBadge(s: s, size: 26)
            } compactTrailing: {
                When(s: s, size: 15, stale: stale, compact: true)
            } minimal: {
                Image(systemName: phaseSymbol(s)).font(.system(size: 12, weight: .bold)).foregroundColor(accent)
            }
            .keylineTint(accent)
        }
    }
}

private struct LockScreen: View {
    let s: KavTripAttributes.ContentState
    let destination: String
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Circle().fill(Color(hex: s.accent)).frame(width: 9, height: 9)
                Text("Kav").font(.subheadline.weight(.bold)).foregroundColor(.white)
                Spacer()
                if !s.line.isEmpty { Plate(s: s) }
            }
            Track(s: s)
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(s.title).font(.headline).foregroundColor(.white).lineLimit(2)
                    Text(s.detail).font(.subheadline).foregroundColor(.white.opacity(0.7)).lineLimit(1)
                }
                Spacer(minLength: 6)
                When(s: s, size: 22, stale: stale)
            }
        }
        .padding(16)
    }
}

// The whole trip as a track, from setting off to arriving, filling as time goes; the phase's sign rides
// at its start, the vehicle and the flag at its end.
private struct Track: View {
    let s: KavTripAttributes.ContentState

    var body: some View {
        let accent = Color(hex: s.accent)
        HStack(spacing: 8) {
            Image(systemName: phaseSymbol(s)).font(.system(size: 17, weight: .semibold)).foregroundColor(.white)
            if s.arrive > s.depart {
                ProgressView(timerInterval: s.depart...s.arrive, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                    .progressViewStyle(.linear).tint(accent)
            } else {
                Capsule().fill(Color.white.opacity(0.3)).frame(height: 4)
            }
            Image(systemName: s.phase == "ride" ? "flag.checkered" : modeSymbol(s.mode)).font(.system(size: 17, weight: .semibold)).foregroundColor(.white)
        }
    }
}

// When it happens: the signal when it's live, then the minutes and seconds left, counted by the system.
private struct When: View {
    let s: KavTripAttributes.ContentState
    let size: CGFloat
    var stale = false
    var compact = false

    var body: some View {
        let accent = Color(hex: s.accent)
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            if s.live { Image(systemName: "wifi").rotationEffect(.degrees(45)).font(.system(size: size * 0.62, weight: .bold)) }
            if !stale && s.minutes > 0 {
                // "4 min", as Moovit shows it, while Kav keeps the card fresh.
                Text(String(s.minutes))
                Text("min").font(.system(size: size * 0.62, weight: .bold, design: .rounded))
            } else if !stale && s.minutes == 0 && s.target > Date().addingTimeInterval(-60) {
                Text(s.phase == "wait" || s.phase == "walk" ? "Now" : "0").font(.system(size: size, weight: .bold, design: .rounded))
            } else if s.target > Date() {
                Text(timerInterval: Date()...s.target, countsDown: true)
                    .monospacedDigit()
                    .frame(maxWidth: compact ? 50 : 96, alignment: .trailing)
            } else {
                Text(s.phase == "wait" ? "Now" : "—")
            }
        }
        .font(.system(size: size, weight: .bold, design: .rounded))
        .foregroundColor(accent)
        .lineLimit(1)
    }
}

// What to do now, in a ring: an hourglass while waiting, the vehicle while riding, a figure walking.
private struct PhaseBadge: View {
    let s: KavTripAttributes.ContentState
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.35), lineWidth: size * 0.09)
            Image(systemName: phaseSymbol(s)).font(.system(size: size * 0.42, weight: .bold)).foregroundColor(.white)
        }
        .frame(width: size, height: size)
    }
}

// The line on its colour, with the mode before it.
private struct Plate: View {
    let s: KavTripAttributes.ContentState

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: modeSymbol(s.mode)).font(.caption.weight(.bold))
            Text(s.line).font(.system(size: 15, weight: .bold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.6)
        }
        .foregroundColor(.white)
        .padding(.horizontal, 7).padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color(hex: s.color)))
    }
}

private func phaseSymbol(_ s: KavTripAttributes.ContentState) -> String {
    switch s.phase {
    case "wait": return "hourglass"
    case "walk": return "figure.walk"
    case "arrive": return "flag.checkered"
    default: return modeSymbol(s.mode)
    }
}

private func modeSymbol(_ mode: String) -> String {
    switch mode {
    case "tram": return "tram.fill"
    case "train", "subway": return "train.side.front.car"
    case "cable", "gondola", "funicular": return "cablecar.fill"
    case "ferry": return "ferry.fill"
    case "taxi": return "car.fill"
    case "walk": return "flag.checkered"
    default: return "bus.fill"
    }
}

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let v = UInt64(h, radix: 16) ?? 0x9ABEFF
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
