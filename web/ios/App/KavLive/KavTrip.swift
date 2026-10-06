import ActivityKit
import Foundation

// A trip under way, as the lock screen and the Dynamic Island show it. Shared by the app, which starts
// and updates it, and the KavLive extension, which draws it.
@available(iOS 16.1, *)
struct KavTripAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // "wait" (for the vehicle at your stop), "ride" (to the stop you get off at), "walk" or "arrive".
        var phase: String
        // What the countdown counts to, in words: "72 at your stop in", "Get off in".
        var label: String
        // The stop it is about: where you get on, or where you get off.
        var stop: String
        // The line(s), "72" or "72 / 27", and its mode: bus, tram, train, cable, ferry, taxi.
        var line: String
        var mode: String
        // The line's colour and Kav's accent, as #RRGGBB.
        var color: String
        var accent: String
        // When the countdown ends, and when the trip does.
        var target: Date
        var arrive: Date
        var live: Bool
        var step: Int
        var steps: Int
    }

    var destination: String
}
