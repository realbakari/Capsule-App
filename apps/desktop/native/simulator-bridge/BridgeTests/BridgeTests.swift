import Foundation
import Network
import XCTest

/*
 * Capsule's simulator touch bridge.
 *
 * Apple's `simctl` can show a simulator but cannot touch it. This is one
 * XCUITest that never ends: it serves HTTP on the loopback port the desktop
 * chose and turns each request into a public XCTest gesture. Nothing private,
 * nothing installed; Xcode builds it once and runs it per device.
 *
 * Every request needs the token the desktop minted for this launch. Loopback
 * is not authentication: anything on this Mac could otherwise drive a device.
 */

private let springboardId = "com.apple.springboard"

final class BridgeTests: XCTestCase {
  override func setUp() {
    super.setUp()
    continueAfterFailure = true
  }

  func testServe() throws {
    let environment = ProcessInfo.processInfo.environment
    guard
      let rawPort = environment["CAPSULE_BRIDGE_PORT"].flatMap({ UInt16($0) }),
      let port = NWEndpoint.Port(rawValue: rawPort),
      let token = environment["CAPSULE_BRIDGE_TOKEN"], token.utf8.count >= 32
    else {
      XCTFail("CAPSULE_BRIDGE_PORT and CAPSULE_BRIDGE_TOKEN are required.")
      return
    }
    let server = BridgeServer(port: port, token: token)
    try server.start()
    NSLog("CAPSULE_BRIDGE_READY port=%d", Int(rawPort))
    while !server.stopped {
      RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.2))
    }
  }
}

// MARK: - Commands

struct Command: Decodable {
  let type: String
  let x: Double?
  let y: Double?
  let toX: Double?
  let toY: Double?
  let duration: Double?
  let text: String?
  let key: String?
  let candidates: [String]?
  let value: String?
}

enum BridgeError: Error {
  case invalid(String)
  case failed(String)
}

/** Runs one command on the main thread, where XCUITest wants to be. */
final class Gestures {
  private lazy var springboard = XCUIApplication(bundleIdentifier: springboardId)

  private func point(_ x: Double?, _ y: Double?) throws -> XCUICoordinate {
    guard let x, let y, x.isFinite, y.isFinite, x >= 0, y >= 0 else { throw BridgeError.invalid("A tap needs x and y in points.") }
    return springboard.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
  }

  /** The app with keyboard focus: the first running candidate in the foreground, else the home screen. */
  private func foreground(_ candidates: [String]?) -> XCUIApplication {
    for bundleId in candidates ?? [] {
      let app = XCUIApplication(bundleIdentifier: bundleId)
      if app.state == .runningForeground { return app }
    }
    return springboard
  }

  static func orientationName(_ orientation: UIDeviceOrientation) -> String {
    switch orientation {
    case .landscapeLeft: return "landscapeLeft"
    case .landscapeRight: return "landscapeRight"
    case .portraitUpsideDown: return "portraitUpsideDown"
    default: return "portrait"
    }
  }

  static func orientation(named value: String) -> UIDeviceOrientation? {
    switch value {
    case "portrait": return .portrait
    case "landscapeLeft": return .landscapeLeft
    case "landscapeRight": return .landscapeRight
    case "portraitUpsideDown": return .portraitUpsideDown
    default: return nil
    }
  }

  func run(_ command: Command) throws -> [String: Any] {
    switch command.type {
    case "status":
      let size = springboard.frame.size
      return ["width": Double(size.width), "height": Double(size.height), "orientation": Self.orientationName(XCUIDevice.shared.orientation)]
    case "orientation":
      guard let value = command.value, let orientation = Self.orientation(named: value) else { throw BridgeError.invalid("Orientation must be portrait, landscapeLeft, landscapeRight or portraitUpsideDown.") }
      XCUIDevice.shared.orientation = orientation
      // The frame follows the rotation; report the new size so taps keep mapping.
      let rotated = springboard.frame.size
      return ["width": Double(rotated.width), "height": Double(rotated.height), "orientation": Self.orientationName(XCUIDevice.shared.orientation)]
    case "tap":
      try point(command.x, command.y).tap()
      return [:]
    case "press":
      let duration = min(max(command.duration ?? 0.8, 0.1), 10)
      try point(command.x, command.y).press(forDuration: duration)
      return [:]
    case "swipe":
      let start = try point(command.x, command.y)
      let end = try point(command.toX, command.toY)
      // A short hold before moving: a zero hold is read as a tap on some controls.
      start.press(forDuration: min(max(command.duration ?? 0.1, 0.05), 5), thenDragTo: end)
      return [:]
    case "text":
      guard let text = command.text, !text.isEmpty, text.utf8.count <= 4000 else { throw BridgeError.invalid("Text to type is required.") }
      let app = foreground(command.candidates)
      guard app.keyboards.count > 0 else { throw BridgeError.failed("No text field is focused on the device, so there is nothing to type into.") }
      app.typeText(text)
      return ["app": app.description]
    case "key":
      let app = foreground(command.candidates)
      guard app.keyboards.count > 0 else { throw BridgeError.failed("No text field is focused on the device.") }
      switch command.key {
      case "return": app.typeText(XCUIKeyboardKey.return.rawValue)
      case "delete": app.typeText(XCUIKeyboardKey.delete.rawValue)
      default: throw BridgeError.invalid("Unknown key.")
      }
      return [:]
    case "home":
      XCUIDevice.shared.press(.home)
      return [:]
    case "stop":
      return ["stopping": true]
    default:
      throw BridgeError.invalid("Unknown command \(command.type).")
    }
  }
}

// MARK: - A very small HTTP server

final class BridgeServer {
  private let listener: NWListener
  private let token: [UInt8]
  private let queue = DispatchQueue(label: "dev.capsule.simulator-bridge")
  private let gestures = Gestures()
  private(set) var stopped = false

  init(port: NWEndpoint.Port, token: String) {
    let parameters = NWParameters.tcp
    parameters.requiredInterfaceType = .loopback
    parameters.allowLocalEndpointReuse = true
    self.listener = try! NWListener(using: parameters, on: port)
    self.token = Array(token.utf8)
  }

  func start() throws {
    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
    listener.start(queue: queue)
  }

  private func accept(_ connection: NWConnection) {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready: self?.receive(connection, buffer: Data())
      case .failed, .cancelled: connection.cancel()
      default: break
      }
    }
    connection.start(queue: queue)
  }

  private func receive(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
      guard let self else { return }
      var buffer = buffer
      if let data { buffer.append(data) }
      if buffer.count > 128 * 1024 { self.respond(connection, status: 413, body: ["ok": false, "error": "Request too large."]); return }
      if let request = HTTPRequest.parse(buffer) {
        self.handle(request, over: connection)
      } else if error != nil || complete {
        connection.cancel()
      } else {
        self.receive(connection, buffer: buffer)
      }
    }
  }

  private func authorized(_ request: HTTPRequest) -> Bool {
    guard let presented = request.headers["x-capsule-bridge-token"] else { return false }
    let candidate = Array(presented.utf8)
    var difference = candidate.count ^ token.count
    for index in 0..<token.count {
      difference |= Int((index < candidate.count ? candidate[index] : 0) ^ token[index])
    }
    return difference == 0
  }

  private func handle(_ request: HTTPRequest, over connection: NWConnection) {
    guard authorized(request) else { respond(connection, status: 401, body: ["ok": false, "error": "Unauthorized."]); return }
    guard request.method == "POST", request.path == "/command" else { respond(connection, status: 404, body: ["ok": false, "error": "Not found."]); return }
    guard let command = try? JSONDecoder().decode(Command.self, from: request.body) else {
      respond(connection, status: 400, body: ["ok": false, "error": "The command must be a JSON object with a type."]); return
    }
    DispatchQueue.main.async { [self] in
      do {
        var result = try gestures.run(command)
        result["ok"] = true
        respond(connection, status: 200, body: result)
        if command.type == "stop" { stopped = true; listener.cancel() }
      } catch BridgeError.invalid(let message) {
        respond(connection, status: 400, body: ["ok": false, "error": message])
      } catch BridgeError.failed(let message) {
        respond(connection, status: 409, body: ["ok": false, "error": message])
      } catch {
        respond(connection, status: 500, body: ["ok": false, "error": String(describing: error)])
      }
    }
  }

  private func respond(_ connection: NWConnection, status: Int, body: [String: Any]) {
    let json = (try? JSONSerialization.data(withJSONObject: body)) ?? Data("{}".utf8)
    var head = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\n"
    head += "Content-Type: application/json\r\nContent-Length: \(json.count)\r\nConnection: close\r\n\r\n"
    var payload = Data(head.utf8)
    payload.append(json)
    connection.send(content: payload, completion: .contentProcessed { _ in connection.cancel() })
  }
}

struct HTTPRequest {
  let method: String
  let path: String
  let headers: [String: String]
  let body: Data

  /** nil while more bytes are needed; a complete request once the body has arrived. */
  static func parse(_ data: Data) -> HTTPRequest? {
    guard let headerEnd = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    guard let head = String(data: data[data.startIndex..<headerEnd.lowerBound], encoding: .utf8) else { return nil }
    var lines = head.components(separatedBy: "\r\n")
    let request = lines.removeFirst().split(separator: " ")
    guard request.count >= 2 else { return nil }
    var headers: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { continue }
      headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    let length = Int(headers["content-length"] ?? "0") ?? 0
    let bodyStart = headerEnd.upperBound
    guard data.count - bodyStart >= length else { return nil }
    return HTTPRequest(method: String(request[0]), path: String(request[1]), headers: headers, body: data[bodyStart..<(bodyStart + length)])
  }
}
