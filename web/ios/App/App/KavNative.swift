import ActivityKit
import AVFoundation
import BackgroundTasks
import CoreLocation
import Foundation
import JavaScriptCore
import UIKit
import UserNotifications
import Capacitor

// What Kav's web code can't do from inside the web view: talk to Moovit with the headers Moovit's app
// sends (a web page can't set them, and Moovit doesn't allow other sites), keep the 185 MB map on the
// phone and read pieces of it, and keep the screen on while navigating.
@objc(KavNativePlugin)
public class KavNativePlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate, NotificationHandlerProtocol {
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
        CAPPluginMethod(name: "scanQr", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stateRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stateWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifyAllow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifyAllowed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifySet", returnType: CAPPluginReturnPromise),
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

    private func fileURL(_ name: String) throws -> URL { try KavFiles.url(name) }

    // request({ method, url, headers, body (base64), timeout (ms) }) -> { status, headers, body (base64) }
    @objc func request(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), url.scheme == "https" else { return call.reject("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = call.getString("method") ?? "GET"
        req.timeoutInterval = (call.getDouble("timeout") ?? 25000) / 1000
        for (k, v) in call.getObject("headers") ?? [:] { if let v = v as? String { req.setValue(v, forHTTPHeaderField: k) } }
        if let b = call.getString("body"), let data = Data(base64Encoded: b) { req.httpBody = data }
        // A payment shouldn't be cut off because the phone was locked or Kav left the screen mid-request.
        let bg = BackgroundTask()
        session.dataTask(with: req) { data, response, error in
            defer { bg.end() }
            // The code tells the app whether the request surely never left (no network, no host), so that
            // only then is a payment sent again.
            if let error = error { return call.reject(error.localizedDescription, String((error as? URLError)?.code.rawValue ?? 0)) }
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
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error = error, let (call, _, _) = untrack(task.taskIdentifier) else { return }
        call.reject(error.localizedDescription)
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
            phase: call.getString("phase") ?? "wait", title: call.getString("title") ?? "", detail: call.getString("detail") ?? "",
            label: call.getString("label") ?? "", stop: call.getString("stop") ?? "",
            line: call.getString("line") ?? "", mode: call.getString("mode") ?? "bus", color: call.getString("color") ?? "#3E9B5C",
            accent: call.getString("accent") ?? "#9ABEFF", target: date("target"), depart: date("depart"), arrive: date("arrive"),
            live: call.getBool("live") ?? false, step: call.getInt("step") ?? 0, steps: call.getInt("steps") ?? 1, minutes: 0)
    }

    // Kav run by another app rather than installed: its bundle lies in the host's data (LiveContainer keeps
    // its apps in Documents/Applications) instead of where iOS installs apps, or the host says so.
    private static var hosted: Bool {
        let path = Bundle.main.bundlePath.lowercased()
        return path.contains("livecontainer") || path.contains("/documents/applications/")
            || ProcessInfo.processInfo.environment["LC_HOME_PATH"] != nil
    }

    // Keeps the card in whole minutes, as Moovit's: Kav stays awake in the background on location, as
    // navigation does, and counts the minutes again every 20 seconds.
    private var keeper: AnyObject?

    // liveStart({ destination, ...state }): one trip at a time, so any earlier one ends first. Says why not
    // when it can't, so the app can tell the person.
    @objc func liveStart(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve(["ok": false, "why": "ios"]) }
        // Run inside LiveContainer (or another app that hosts apps), Kav isn't installed as itself: iOS
        // never sees its lock screen extension, so there's nothing it could show.
        if Self.hosted { return call.resolve(["ok": false, "why": "container"]) }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return call.resolve(["ok": false, "why": "disabled"]) }
        let state = Self.tripState(call)
        let attributes = KavTripAttributes(destination: call.getString("destination") ?? "")
        Task { @MainActor in
            // The earlier trip's keeper stops first, so it can't go on with location and a timer if this one fails.
            (self.keeper as? TripKeeper)?.stop()
            self.keeper = nil
            for a in Activity<KavTripAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            do {
                let activity = try Activity.request(attributes: attributes, content: TripKeeper.content(state), pushType: nil)
                let k = TripKeeper(activity: activity, state: state)
                self.keeper = k
                k.start()
                call.resolve(["ok": true])
            } catch { call.resolve(["ok": false, "why": error.localizedDescription]) }
        }
    }

    @objc func liveUpdate(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve(["ok": false]) }
        let state = Self.tripState(call)
        Task { @MainActor in
            // No card any more (ended from the lock screen, by iOS, or by another start): the app starts one again.
            guard let k = self.keeper as? TripKeeper, k.running else { return call.resolve(["ok": false]) }
            k.state = state
            await k.push()
            call.resolve(["ok": true])
        }
    }

    @objc func liveEnd(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        Task { @MainActor in
            (self.keeper as? TripKeeper)?.stop()
            self.keeper = nil
            for a in Activity<KavTripAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            call.resolve()
        }
    }

    // ---- the QR code on a bus, read by the camera natively ----

    // scanQr({ title, cancel, torch }) -> { code } or { cancelled: true }; rejects with code "denied" when the
    // camera is off for Kav.
    @objc func scanQr(_ call: CAPPluginCall) {
        let present = {
            DispatchQueue.main.async {
                guard AVCaptureDevice.default(for: .video) != nil else { return call.reject("No camera", "unavailable") }
                guard let host = self.bridge?.viewController else { return call.reject("No view") }
                let scanner = QrScannerController(title: call.getString("title") ?? "", cancel: call.getString("cancel") ?? "Cancel",
                                                  torch: call.getString("torch") ?? "Light") { code in
                    if let code = code { call.resolve(["code": code]) } else { call.resolve(["cancelled": true]) }
                }
                var top = host
                while let next = top.presentedViewController { top = next }
                top.present(scanner, animated: true)
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: present()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in ok ? present() : call.reject("Camera denied", "denied") }
        default: call.reject("Camera denied", "denied")
        }
    }

    // ---- the backend's saved state, kept by the app rather than the web view ----

    // The web view's storage can be cleared by iOS when space runs low; losing the payment user would mean
    // moving the account to Kav again. "pay" (tokens that can spend money) goes to the Keychain, on this
    // device only; anything else to a file. stateRead({ key }) -> { value: string | null }.
    @objc func stateRead(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        if key == "pay", let v = Keychain.read(key) { return call.resolve(["value": v]) }
        do {
            let u = try fileURL("state-\(key).json")
            if let data = try? Data(contentsOf: u), let v = String(data: data, encoding: .utf8) { return call.resolve(["value": v]) }
            call.resolve(["value": NSNull()])
        } catch { call.reject(error.localizedDescription) }
    }

    // stateWrite({ key, value }): a null value removes it.
    @objc func stateWrite(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        let value = call.getString("value")
        do {
            let u = try fileURL("state-\(key).json")
            if key == "pay" {
                if let v = value, Keychain.write(key, v) { try? FileManager.default.removeItem(at: u); return call.resolve() }
                if value == nil { Keychain.delete(key); try? FileManager.default.removeItem(at: u); return call.resolve() }
                // No Keychain (some ways of installing an app leave it without one): the file below.
            }
            if let v = value { try Data(v.utf8).write(to: u, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
            else { try? FileManager.default.removeItem(at: u) }
            call.resolve()
        } catch { call.reject(error.localizedDescription) }
    }

    // haptic({ kind: "tap" | "alert" }): WebKit has no navigator.vibrate.
    @objc func haptic(_ call: CAPPluginCall) {
        let alert = call.getString("kind") == "alert"
        DispatchQueue.main.async {
            if alert { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
            else { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
            call.resolve()
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on; call.resolve() }
    }

    // ---- notifications: reminders to leave, and alerts on the lines you follow ----

    // notifyAllow() -> { granted }: asks the first time, then says what was chosen.
    @objc func notifyAllow(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }

    // notifyAllowed() -> { granted }, without asking.
    @objc func notifyAllowed(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            call.resolve(["granted": s.authorizationStatus == .authorized || s.authorizationStatus == .provisional])
        }
    }

    // notifySet({ json }): { notices: [{ id, title, body, at }], cancel: [id] }, as the check (jobs.ts) gives them.
    @objc func notifySet(_ call: CAPPluginCall) {
        KavNotices.apply(json: call.getString("json") ?? "{}")
        call.resolve()
    }

    // Shown while Kav is open too, as a banner.
    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions { [.banner, .list, .sound] }

    public func didReceive(response: UNNotificationResponse) {
        notifyListeners("notificationTap", data: ["id": response.notification.request.identifier])
    }
}

// Capacitor's view controller, with Kav's plugin registered on it, and given Kav's notifications.
class KavViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        let plugin = KavNativePlugin()
        bridge?.registerPluginInstance(plugin)
        bridge?.notificationRouter.localNotificationHandler = plugin
    }
}

// Files live in Application Support, out of iCloud backups.
enum KavFiles {
    static func url(_ name: String) throws -> URL {
        guard !name.isEmpty, !name.contains(".."), !name.hasPrefix("/") else { throw NSError(domain: "Kav", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bad file name"]) }
        var dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("kav", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir.appendingPathComponent(name)
    }

    static func read(_ name: String) -> String? {
        guard let u = try? url(name), let data = try? Data(contentsOf: u) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ name: String, _ value: String) {
        guard let u = try? url(name) else { return }
        try? Data(value.utf8).write(to: u, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

// Notifications set, moved or taken back: a notice's id replaces any earlier one with the same id.
enum KavNotices {
    static func apply(json: String) {
        guard let data = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        apply(o)
    }

    static func apply(_ o: [String: Any]) {
        let center = UNUserNotificationCenter.current()
        let cancel = o["cancel"] as? [String] ?? []
        if !cancel.isEmpty { center.removePendingNotificationRequests(withIdentifiers: cancel) }
        for n in o["notices"] as? [[String: Any]] ?? [] {
            guard let id = n["id"] as? String else { continue }
            let content = UNMutableNotificationContent()
            content.title = n["title"] as? String ?? ""
            content.body = n["body"] as? String ?? ""
            content.sound = .default
            let wait = ((n["at"] as? NSNumber)?.doubleValue ?? 0) / 1000 - Date().timeIntervalSince1970
            // No trigger: at once.
            let trigger = wait > 1 ? UNTimeIntervalNotificationTrigger(timeInterval: wait, repeats: false) : nil
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        }
    }
}

// While Kav is closed: iOS wakes it now and then (Background App Refresh), and the check the app runs when
// it opens (jobs.ts) runs here too, from kav-bg.js in JavaScriptCore, since the web view stays asleep. It
// moves a reminder to leave by the bus's live time, and tells of new alerts on the lines you follow.
enum KavBackground {
    static let taskId = "com.gilsamedia.kav.refresh"
    private static var running: JobRunner?

    // At launch, before it ends, as iOS requires.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return task.setTaskCompleted(success: false) }
            run(task)
        }
    }

    // Asked for each time Kav goes to the background, if there's anything to keep an eye on. iOS decides when.
    static func schedule() {
        guard hasJobs() else { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskId); return }
        let request = BGAppRefreshTaskRequest(identifier: taskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func hasJobs() -> Bool {
        guard let text = KavFiles.read("state-jobs.json"), let data = text.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return !((o["reminders"] as? [Any])?.isEmpty ?? true) || !((o["lines"] as? [Any])?.isEmpty ?? true)
    }

    private static func run(_ task: BGAppRefreshTask) {
        schedule()
        let runner = JobRunner()
        DispatchQueue.main.async { running = runner }
        task.expirationHandler = { runner.finish(nil) }
        runner.start { ok in
            task.setTaskCompleted(success: ok)
            DispatchQueue.main.async { if running === runner { running = nil } }
        }
    }
}

// One run of kav-bg.js: everything it does goes through one queue, and its requests through URLSession.
final class JobRunner {
    private let queue = DispatchQueue(label: "kav.background")
    private var context: JSContext?
    private var completion: ((Bool) -> Void)?
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    func start(_ done: @escaping (Bool) -> Void) {
        queue.async {
            self.completion = done
            guard let url = Bundle.main.url(forResource: "kav-bg", withExtension: "js", subdirectory: "public"),
                  let source = try? String(contentsOf: url, encoding: .utf8), let ctx = JSContext() else { return self.finish(nil) }
            self.context = ctx
            ctx.exceptionHandler = { _, e in NSLog("Kav background: %@", e?.toString() ?? "?") }
            let log: @convention(block) (String) -> Void = { NSLog("Kav background: %@", $0) }
            let timeout: @convention(block) (Double, JSValue) -> Void = { [weak self] ms, f in
                self?.queue.asyncAfter(deadline: .now() + ms / 1000) { _ = f.call(withArguments: []) }
            }
            let request: @convention(block) (String, String, String, JSValue, Double, JSValue) -> Void = { [weak self] method, url, headers, body, ms, done in
                self?.request(method: method, url: url, headers: headers, body: body.isString ? body.toString() : nil, timeoutMs: ms, done: done)
            }
            let finished: @convention(block) (String) -> Void = { [weak self] out in self?.finish(out) }
            ctx.setObject(log, forKeyedSubscript: "__kavLog" as NSString)
            ctx.setObject(timeout, forKeyedSubscript: "__kavTimeout" as NSString)
            ctx.setObject(request, forKeyedSubscript: "__kavRequest" as NSString)
            ctx.evaluateScript(source)
            ctx.setObject(finished, forKeyedSubscript: "__kavDone" as NSString)
            let saved = { (name: String) -> Any in KavFiles.read(name).map { $0 as Any } ?? NSNull() }
            let input: [String: Any] = ["jobs": saved("state-jobs.json"), "state": saved("state-background.json")]
            guard let data = try? JSONSerialization.data(withJSONObject: input), let text = String(data: data, encoding: .utf8),
                  let main = ctx.objectForKeyedSubscript("kavBackground"), !main.isUndefined,
                  let callback = ctx.objectForKeyedSubscript("__kavDone") else { return self.finish(nil) }
            _ = main.call(withArguments: [text, callback])
        }
    }

    private func request(method: String, url: String, headers: String, body: String?, timeoutMs: Double, done: JSValue) {
        let reply: (Int, String, String, String?) -> Void = { [weak self] status, h, b, error in
            let e: Any = error.map { $0 as Any } ?? NSNull()
            self?.queue.async { _ = done.call(withArguments: [status, h, b, e]) }
        }
        guard let u = URL(string: url), u.scheme == "https" else { return reply(0, "{}", "", "Bad URL") }
        var req = URLRequest(url: u)
        req.httpMethod = method
        req.timeoutInterval = timeoutMs / 1000
        if let data = headers.data(using: .utf8), let h = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            for (k, v) in h { req.setValue(v, forHTTPHeaderField: k) }
        }
        if let b = body, let data = Data(base64Encoded: b) { req.httpBody = data }
        session.dataTask(with: req) { data, response, error in
            if let error = error { return reply(0, "{}", "", error.localizedDescription) }
            guard let http = response as? HTTPURLResponse else { return reply(0, "{}", "", "No response") }
            var h: [String: String] = [:]
            for (k, v) in http.allHeaderFields { h[String(describing: k).lowercased()] = String(describing: v) }
            let headerText = (try? JSONSerialization.data(withJSONObject: h)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            reply(http.statusCode, headerText, (data ?? Data()).base64EncodedString(), nil)
        }.resume()
    }

    // With kav-bg.js's answer, or nil when it couldn't run or iOS ran out of patience. Once only.
    func finish(_ out: String?) {
        queue.async {
            guard let completion = self.completion else { return }
            self.completion = nil
            if let out = out, let data = out.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let jobs = o["jobs"] as? String { KavFiles.write("state-jobs.json", jobs) }
                if let state = o["state"] as? String { KavFiles.write("state-background.json", state) }
                KavNotices.apply(o)
            }
            self.context = nil
            self.session.invalidateAndCancel()
            completion(out != nil)
        }
    }
}

// One trip on the lock screen: its card, kept in whole minutes while Kav is in the background.
@available(iOS 16.2, *)
@MainActor
final class TripKeeper: NSObject, CLLocationManagerDelegate {
    let activity: Activity<KavTripAttributes>
    var state: KavTripAttributes.ContentState
    private var timer: Timer?
    private var watcher: Task<Void, Never>?
    private let location = CLLocationManager()
    private(set) var running = false

    init(activity: Activity<KavTripAttributes>, state: KavTripAttributes.ContentState) {
        self.activity = activity
        self.state = state
        super.init()
    }

    // Whole minutes to the moment, rounded up as Moovit rounds them; stale soon after, so if Kav is stopped
    // the card falls back to the clock iOS runs by itself instead of showing old minutes.
    static func content(_ s: KavTripAttributes.ContentState) -> ActivityContent<KavTripAttributes.ContentState> {
        var s = s
        // Under a minute away is "Now": the vehicle is pulling in.
        let left = s.target.timeIntervalSinceNow
        s.minutes = left < 60 ? 0 : Int((left / 60).rounded(.up))
        return ActivityContent(state: s, staleDate: Date().addingTimeInterval(75))
    }

    func start() {
        running = true
        // Dismissed on the lock screen or ended by iOS: nothing left to keep current, so the location stops too.
        watcher = Task { @MainActor [weak self, activity] in
            for await s in activity.activityStateUpdates where s == .ended || s == .dismissed {
                self?.stop()
                break
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.push() }
        }
        // Location in the background is what keeps a navigating app running, and the timer with it.
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyHundredMeters
        location.distanceFilter = 50
        location.pausesLocationUpdatesAutomatically = false
        if Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] != nil {
            location.allowsBackgroundLocationUpdates = true
            location.showsBackgroundLocationIndicator = true
        }
        location.startUpdatingLocation()
    }

    func push() async {
        await activity.update(Self.content(state))
    }

    func stop() {
        running = false
        watcher?.cancel()
        watcher = nil
        timer?.invalidate()
        timer = nil
        location.stopUpdatingLocation()
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {}
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

// Asks iOS for a little time to finish a request if Kav goes to the background, and gives it back after.
final class BackgroundTask {
    private var id = UIBackgroundTaskIdentifier.invalid
    private let lock = NSLock()
    init() { id = UIApplication.shared.beginBackgroundTask(withName: "Kav request") { [weak self] in self?.end() } }
    func end() {
        lock.lock(); let i = id; id = .invalid; lock.unlock()
        if i != .invalid { UIApplication.shared.endBackgroundTask(i) }
    }
}

enum Keychain {
    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "kav", kSecAttrAccount as String: key]
    }
    static func read(_ key: String) -> String? {
        var q = query(key); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ key: String, _ value: String) -> Bool {
        let data = Data(value.utf8)
        let found = SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if found == errSecSuccess { return true }
        guard found == errSecItemNotFound else { return false }
        var q = query(key); q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
    static func delete(_ key: String) { SecItemDelete(query(key) as CFDictionary) }
}

// The camera, full screen, until it sees a QR code: AVFoundation reads it at once and in poor light, where
// reading frames in the web view was slow and needed the web view's own camera prompt.
final class QrScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "kav.scanner")
    private var preview: AVCaptureVideoPreviewLayer?
    private var device: AVCaptureDevice?
    private var finished = false
    private let titleText: String, cancelText: String, torchText: String
    private let done: (String?) -> Void

    init(title: String, cancel: String, torch: String, done: @escaping (String?) -> Void) {
        titleText = title; cancelText = cancel; torchText = torch; self.done = done
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        if let d = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: d), session.canAddInput(input) {
            device = d
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            if session.canAddOutput(output) {
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                if output.availableMetadataObjectTypes.contains(.qr) { output.metadataObjectTypes = [.qr] }
            }
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            view.layer.addSublayer(layer)
            preview = layer
        }

        let frame = UIView()
        frame.translatesAutoresizingMaskIntoConstraints = false
        frame.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
        frame.layer.borderWidth = 3
        frame.layer.cornerRadius = 22
        frame.isUserInteractionEnabled = false
        view.addSubview(frame)

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = titleText
        label.textColor = .white
        label.font = .systemFont(ofSize: 17, weight: .semibold)
        label.textAlignment = .center
        label.numberOfLines = 0
        view.addSubview(label)

        let cancel = Self.button(cancelText)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancel)

        var constraints = [
            frame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frame.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -30),
            frame.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.66),
            frame.heightAnchor.constraint(equalTo: frame.widthAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            label.bottomAnchor.constraint(equalTo: frame.topAnchor, constant: -28),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            cancel.heightAnchor.constraint(equalToConstant: 50),
            cancel.widthAnchor.constraint(greaterThanOrEqualToConstant: 140),
        ]
        if device?.hasTorch == true {
            let torch = Self.button(torchText)
            torch.addTarget(self, action: #selector(torchTapped), for: .touchUpInside)
            view.addSubview(torch)
            constraints += [
                torch.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                torch.bottomAnchor.constraint(equalTo: cancel.topAnchor, constant: -14),
                torch.heightAnchor.constraint(equalToConstant: 50),
                torch.widthAnchor.constraint(greaterThanOrEqualToConstant: 140),
            ]
        }
        NSLayoutConstraint.activate(constraints)
    }

    private static func button(_ title: String) -> UIButton {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.setTitle(title, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        b.backgroundColor = UIColor.white.withAlphaComponent(0.18)
        b.layer.cornerRadius = 25
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 28, bottom: 0, right: 28)
        return b
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let s = session
        queue.async { if !s.isRunning { s.startRunning() } }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        setTorch(false)
        let s = session
        queue.async { if s.isRunning { s.stopRunning() } }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = objects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first(where: { !$0.isEmpty }) else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        finish(code)
    }

    @objc private func cancelTapped() { finish(nil) }

    @objc private func torchTapped() { setTorch(device?.torchMode != .on) }

    private func setTorch(_ on: Bool) {
        guard let d = device, d.hasTorch, (try? d.lockForConfiguration()) != nil else { return }
        d.torchMode = on ? .on : .off
        d.unlockForConfiguration()
    }

    private func finish(_ code: String?) {
        guard !finished else { return }
        finished = true
        let done = self.done
        dismiss(animated: true) { done(code) }
    }
}
