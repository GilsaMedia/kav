import ActivityKit
import Foundation

// A trip under way, as the lock screen and the Dynamic Island show it. Shared by the app, which starts
// and updates it, and the KavLive extension, which draws it.
@available(iOS 16.1, *)
struct KavTripAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // "wait" (for the vehicle at your stop), "ride" (to the stop you get off at), "walk" or "arrive".
        var phase: String
        // What to do now, as Moovit words it: "Wait for one of these options", "Ride 5 stops to …".
        var title: String
        // Under it: the lines and where they go, or the stop.
        var detail: String
        // What the countdown counts to, short: "at your stop in", "get off in".
        var label: String
        var stop: String
        // The line(s), "72" or "72 / 27", and its mode: bus, tram, train, cable, ferry, taxi.
        var line: String
        var mode: String
        // The line's colour and Kav's accent, as #RRGGBB.
        var color: String
        var accent: String
        // When the countdown ends, when the trip set off and when it ends.
        var target: Date
        var depart: Date
        var arrive: Date
        var live: Bool
        var step: Int
        var steps: Int
    }

    var destination: String
}
