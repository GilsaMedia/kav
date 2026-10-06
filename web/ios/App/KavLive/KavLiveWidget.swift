import ActivityKit
import SwiftUI
import WidgetKit

// The trip on the lock screen and in the Dynamic Island, as Moovit shows one: the line, what is next,
// and a countdown that keeps running with Kav in the background.
@main
struct KavLiveBundle: WidgetBundle {
    var body: some Widget {
        KavTripLive()
    }
}

struct KavTripLive: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KavTripAttributes.self) { ctx in
            LockScreen(s: ctx.state, destination: ctx.attributes.destination)
                .activityBackgroundTint(Color.black.opacity(0.82))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { ctx in
            let s = ctx.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Plate(s: s).padding(.leading, 6).padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(s: s)
                        .font(.system(size: 26, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundColor(Color(hex: s.accent))
                        .frame(maxWidth: 110, alignment: .trailing)
                        .padding(.trailing, 6).padding(.top, 2)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(s.label).font(.caption.weight(.semibold)).foregroundColor(.secondary).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(s.stop).font(.headline).lineLimit(1)
                        HStack(spacing: 6) {
                            Steps(s: s)
                            Spacer()
                            Image(systemName: "flag.checkered").font(.caption2)
                            Text(s.arrive, style: .time).font(.caption.monospacedDigit())
                        }
                        .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                Plate(s: s, compact: true)
            } compactTrailing: {
                Countdown(s: s)
                    .font(.system(size: 15, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundColor(Color(hex: s.accent))
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: symbol(s)).foregroundColor(Color(hex: s.accent))
            }
            .keylineTint(Color(hex: s.accent))
        }
    }
}

private struct LockScreen: View {
    let s: KavTripAttributes.ContentState
    let destination: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                Plate(s: s)
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.label).font(.caption.weight(.semibold)).foregroundColor(.white.opacity(0.7)).lineLimit(1)
                    Text(s.stop).font(.headline).foregroundColor(.white).lineLimit(1)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 0) {
                    if s.live {
                        Image(systemName: "dot.radiowaves.up.forward").font(.caption2).foregroundColor(Color(hex: s.accent))
                    }
                    Countdown(s: s)
                        .font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundColor(Color(hex: s.accent))
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 120, alignment: .trailing)
                }
            }
            HStack(spacing: 6) {
                Steps(s: s)
                Spacer()
                Image(systemName: "flag.checkered").font(.caption2)
                Text(destination).font(.caption).lineLimit(1)
                Text(s.arrive, style: .time).font(.caption.monospacedDigit())
            }
            .foregroundColor(.white.opacity(0.7))
        }
        .padding(16)
    }
}

// The line on its colour, with the mode before it; walking shows a figure instead.
private struct Plate: View {
    let s: KavTripAttributes.ContentState
    var compact = false

    var body: some View {
        if s.line.isEmpty {
            Image(systemName: symbol(s)).font(compact ? .caption : .title3).foregroundColor(Color(hex: s.accent))
        } else {
            HStack(spacing: compact ? 2 : 4) {
                Image(systemName: symbol(s)).font(compact ? .system(size: 10, weight: .bold) : .caption.weight(.bold))
                Text(s.line).font(.system(size: compact ? 13 : 17, weight: .bold, design: .rounded)).lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .foregroundColor(.white)
            .padding(.horizontal, compact ? 5 : 8).padding(.vertical, compact ? 2 : 5)
            .background(RoundedRectangle(cornerRadius: compact ? 5 : 7).fill(Color(hex: s.color)))
        }
    }
}

// Minutes and seconds to the moment, counted by the system so it runs with the app asleep.
private struct Countdown: View {
    let s: KavTripAttributes.ContentState

    var body: some View {
        let now = Date()
        if s.target > now {
            Text(timerInterval: now...s.target, countsDown: true)
        } else {
            Text(s.phase == "wait" ? "Now" : "—")
        }
    }
}

// One dot per step of the trip, the current one long.
private struct Steps: View {
    let s: KavTripAttributes.ContentState

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<max(1, min(s.steps, 8)), id: \.self) { i in
                Capsule().fill(i == s.step ? Color(hex: s.accent) : Color.white.opacity(0.3))
                    .frame(width: i == s.step ? 14 : 5, height: 5)
            }
        }
    }
}

private func symbol(_ s: KavTripAttributes.ContentState) -> String {
    switch s.phase {
    case "walk": return "figure.walk"
    case "arrive": return "flag.checkered"
    default:
        switch s.mode {
        case "tram": return "tram.fill"
        case "train", "subway": return "train.side.front.car"
        case "cable", "gondola", "funicular": return "cablecar.fill"
        case "ferry": return "ferry.fill"
        case "taxi": return "car.fill"
        default: return "bus.fill"
        }
    }
}

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let v = UInt64(h, radix: 16) ?? 0x9ABEFF
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
