import ActivityKit
import Foundation
import UIKit
import Capacitor

// What Kav's web code can't do from inside the web view: talk to Moovit with the headers Moovit's app
// sends (a web page can't set them, and Moovit doesn't allow other sites), keep the 185 MB map on the
// phone and read pieces of it, and keep the screen on while navigating.
@objc(KavNativePlugin)
public class KavNativePlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "KavNativePlugin"
    public let jsName = "KavNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fileSize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readRange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liveStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liveUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liveEnd", returnType: CAPPluginReturnPromise),
    ]

    // No cookies, no cache: every request goes out as Kav builds it.
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    // Files live in Application Support, out of iCloud backups.
    private func fileURL(_ name: String) throws -> URL {
        guard !name.isEmpty, !name.contains(".."), !name.hasPrefix("/") else { throw NSError(domain: "Kav", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bad file name"]) }
        var dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("kav", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir.appendingPathComponent(name)
    }

    // request({ method, url, headers, body (base64), timeout (ms) }) -> { status, headers, body (base64) }
    @objc func request(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), url.scheme == "https" else { return call.reject("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = call.getString("method") ?? "GET"
        req.timeoutInterval = (call.getDouble("timeout") ?? 25000) / 1000
        for (k, v) in call.getObject("headers") ?? [:] { if let v = v as? String { req.setValue(v, forHTTPHeaderField: k) } }
        if let b = call.getString("body"), let data = Data(base64Encoded: b) { req.httpBody = data }
        session.dataTask(with: req) { data, response, error in
            if let error = error { return call.reject(error.localizedDescription) }
            guard let http = response as? HTTPURLResponse else { return call.reject("No response") }
            var headers: [String: String] = [:]
            for (k, v) in http.allHeaderFields { headers[String(describing: k).lowercased()] = String(describing: v) }
            call.resolve(["status": http.statusCode, "headers": headers, "body": (data ?? Data()).base64EncodedString()])
        }.resume()
    }

    @objc func fileSize(_ call: CAPPluginCall) {
        do {
            let u = try fileURL(call.getString("name") ?? "")
            let size = (try? FileManager.default.attributesOfItem(atPath: u.path)[.size] as? NSNumber)?.int64Value ?? -1
            call.resolve(["size": size])
        } catch { call.reject(error.localizedDescription) }
    }

    // readRange({ name, offset, length }) -> { data (base64) }: the map reads its tiles a piece at a time.
    @objc func readRange(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        let offset = UInt64(call.getDouble("offset") ?? 0)
        let length = call.getInt("length") ?? 0
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let h = try FileHandle(forReadingFrom: try self.fileURL(name))
                defer { try? h.close() }
                try h.seek(toOffset: offset)
                let data = try h.read(upToCount: length) ?? Data()
                call.resolve(["data": data.base64EncodedString()])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    // download({ url, name, size }): fetched to a temporary file, then moved into place when whole.
    // Touched from the plugin queue and the session delegate queue, so always under the lock.
    private var downloads: [Int: (CAPPluginCall, URL, Int64)] = [:]
    private let lock = NSLock()
    private func track(_ id: Int, _ d: (CAPPluginCall, URL, Int64)) { lock.lock(); downloads[id] = d; lock.unlock() }
    private func tracked(_ id: Int) -> (CAPPluginCall, URL, Int64)? { lock.lock(); defer { lock.unlock() }; return downloads[id] }
    private func untrack(_ id: Int) -> (CAPPluginCall, URL, Int64)? { lock.lock(); defer { lock.unlock() }; return downloads.removeValue(forKey: id) }
    private lazy var downloader = URLSession(configuration: .default, delegate: self, delegateQueue: nil)

    @objc func download(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), url.scheme == "https" else { return call.reject("Bad URL") }
        do {
            let target = try fileURL(call.getString("name") ?? "")
            let task = downloader.downloadTask(with: url)
            call.keepAlive = true
            track(task.taskIdentifier, (call, target, Int64(call.getDouble("size") ?? -1)))
            task.resume()
        } catch { call.reject(error.localizedDescription) }
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : (tracked(downloadTask.taskIdentifier)?.2 ?? -1)
        notifyListeners("downloadProgress", data: ["done": totalBytesWritten, "total": total])
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let (call, target, size) = untrack(downloadTask.taskIdentifier) else { return }
        do {
            let got = (try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.int64Value ?? 0
            if let http = downloadTask.response as? HTTPURLResponse, http.statusCode != 200 { throw NSError(domain: "Kav", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "Download HTTP \(http.statusCode)"]) }
            if size > 0 && got != size { throw NSError(domain: "Kav", code: 2, userInfo: [NSLocalizedDescriptionKey: "Interrupted at \(got / 1_048_576) MB, try again"]) }
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.moveItem(at: location, to: target)
            call.resolve(["size": got])
        } catch { call.reject(error.localizedDescription) }
        call.keepAlive = false
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error = error, let (call, _, _) = untrack(task.taskIdentifier) else { return }
        call.reject(error.localizedDescription)
        call.keepAlive = false
    }

    @objc func remove(_ call: CAPPluginCall) {
        do { try? FileManager.default.removeItem(at: try fileURL(call.getString("name") ?? "")); call.resolve() }
        catch { call.reject(error.localizedDescription) }
    }

    // ---- the trip on the lock screen and in the Dynamic Island (a Live Activity, drawn by KavLive) ----

    @available(iOS 16.2, *)
    private static func tripState(_ call: CAPPluginCall) -> KavTripAttributes.ContentState {
        func date(_ key: String) -> Date { Date(timeIntervalSince1970: (call.getDouble(key) ?? 0) / 1000) }
        return KavTripAttributes.ContentState(
            phase: call.getString("phase") ?? "wait", label: call.getString("label") ?? "", stop: call.getString("stop") ?? "",
            line: call.getString("line") ?? "", mode: call.getString("mode") ?? "bus", color: call.getString("color") ?? "#3E9B5C",
            accent: call.getString("accent") ?? "#9ABEFF", target: date("target"), arrive: date("arrive"),
            live: call.getBool("live") ?? false, step: call.getInt("step") ?? 0, steps: call.getInt("steps") ?? 1)
    }

    // liveStart({ destination, ...state }): one trip at a time, so any earlier one ends first.
    @objc func liveStart(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve(["ok": false]) }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return call.resolve(["ok": false]) }
        let state = Self.tripState(call)
        let attributes = KavTripAttributes(destination: call.getString("destination") ?? "")
        Task {
            for a in Activity<KavTripAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            do {
                _ = try Activity.request(attributes: attributes,
                    content: ActivityContent(state: state, staleDate: state.arrive.addingTimeInterval(30 * 60)), pushType: nil)
                call.resolve(["ok": true])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func liveUpdate(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve(["ok": false]) }
        let state = Self.tripState(call)
        Task {
            for a in Activity<KavTripAttributes>.activities {
                await a.update(ActivityContent(state: state, staleDate: state.arrive.addingTimeInterval(30 * 60)))
            }
            call.resolve(["ok": true])
        }
    }

    @objc func liveEnd(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        Task {
            for a in Activity<KavTripAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            call.resolve()
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on; call.resolve() }
    }
}

// Capacitor's view controller, with Kav's plugin registered on it.
class KavViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KavNativePlugin())
    }
}
