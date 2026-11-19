import ExpoModulesCore
import Foundation

struct RequestOptions: Record {
  @Field var remote: String = ""
  @Field var relay: String? = nil
  @Field var method: String = "GET"
  @Field var path: String = "/"
  @Field var headers: [[String]] = []
  /// UTF-8 request body (the hermes-ui API is JSON only; images and audio travel base64 inside it).
  @Field var body: String? = nil
  @Field var timeoutMs: Double = 30_000
}

/// A response whose body JS reads chunk by chunk; text reads keep incomplete UTF-8 sequences for the next chunk.
private final class Pending: @unchecked Sendable {
  let response: IrohResponse
  var leftover = Data()
  init(_ response: IrohResponse) { self.response = response }
}

/// JS bridge to the Rust iroh-http/1 client (HermesIrohFFI.xcframework through UniFFI); same API as Android.
public final class ExpoIrohModule: Module {
  private var client: IrohClient?
  private var responses: [Int: Pending] = [:]
  private var nextId = 1
  private let lock = NSLock()

  private func requireClient() throws -> IrohClient {
    guard let c = lock.withLock({ client }) else { throw Exception(name: "ERR_IROH", description: "iroh client not created") }
    return c
  }
  private func store(_ r: IrohResponse) -> Int {
    lock.withLock { let id = nextId; nextId += 1; responses[id] = Pending(r); return id }
  }
  private func take(_ id: Int) -> Pending? { lock.withLock { responses.removeValue(forKey: id) } }
  private func get(_ id: Int) -> Pending? { lock.withLock { responses[id] } }
  private static func headers(_ list: [[String]]) -> [Header] { list.filter { $0.count == 2 }.map { Header(name: $0[0], value: $0[1]) } }
  private static func toJs(_ list: [Header]) -> [[String]] { list.map { [$0.name, $0.value] } }
  private static func wrap<T>(_ f: () async throws -> T) async throws -> T {
    do { return try await f() } catch let e as IrohError { throw Exception(name: "ERR_IROH", description: "\(e)") }
  }

  /// Longest prefix of `data` that is complete UTF-8; the rest waits for the next chunk.
  private static func decode(_ data: Data) -> (String, Data) {
    for cut in 0...min(3, data.count) {
      if let s = String(data: data.prefix(data.count - cut), encoding: .utf8) { return (s, data.suffix(cut)) }
    }
    return (String(decoding: data, as: UTF8.self), Data())
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoIroh")

    Function("libraryInfo") { libraryInfo() }

    AsyncFunction("create") { (relayUrl: String?, secretKey: String?) async throws -> [String: String] in
      if let c = self.lock.withLock({ self.client }) { return ["endpointId": c.endpointId(), "secretKey": c.secretKey()] }
      let c = try await Self.wrap { try await IrohClient.create(relayUrl: relayUrl?.isEmpty == false ? relayUrl : nil, relayToken: nil, secretKey: secretKey?.isEmpty == false ? secretKey : nil) }
      self.lock.withLock { self.client = c }
      return ["endpointId": c.endpointId(), "secretKey": c.secretKey()]
    }

    Function("endpointId") { self.lock.withLock { self.client?.endpointId() } }
    Function("relayProblem") { self.lock.withLock { self.client?.relayProblem() } }
    Function("connectionInfo") { (remote: String) -> String? in try? self.lock.withLock { self.client }?.connectionInfo(remote: remote) }

    AsyncFunction("connect") { (remote: String, relay: String?, timeoutMs: Double) async throws in
      let c = try self.requireClient()
      try await Self.wrap { try await c.connect(remote: remote, relay: relay?.isEmpty == false ? relay : nil, timeoutMs: UInt64(timeoutMs)) }
    }

    AsyncFunction("request") { (req: RequestOptions) async throws -> [String: Any] in
      let c = try self.requireClient()
      let r = try await Self.wrap {
        try await c.request(remote: req.remote, relay: req.relay?.isEmpty == false ? req.relay : nil, method: req.method, path: req.path,
                            headers: Self.headers(req.headers), body: Data((req.body ?? "").utf8), timeoutMs: UInt64(req.timeoutMs))
      }
      return ["id": self.store(r), "status": Int(r.status()), "headers": Self.toJs(r.headers())]
    }

    AsyncFunction("read") { (id: Int) async throws -> Data? in
      guard let p = self.get(id) else { return nil }
      let chunk = try await Self.wrap { try await p.response.read() }
      if chunk == nil { _ = self.take(id) }
      return chunk
    }

    AsyncFunction("readText") { (id: Int) async throws -> String? in
      guard let p = self.get(id) else { return nil }
      guard let chunk = try await Self.wrap({ try await p.response.read() }) else { _ = self.take(id); return nil }
      let (text, rest) = Self.decode(p.leftover + chunk)
      p.leftover = rest
      return text
    }

    AsyncFunction("text") { (id: Int) async throws -> String in
      guard let p = self.take(id) else { return "" }
      return String(decoding: try await Self.wrap { try await p.response.bytes() }, as: UTF8.self)
    }

    Function("cancel") { (id: Int) in self.take(id)?.response.cancel() }

    AsyncFunction("download") { (req: RequestOptions, dest: String) async throws -> [String: Any] in
      let c = try self.requireClient()
      let path = dest.hasPrefix("file://") ? String(dest.dropFirst(7)) : dest
      let info = try await Self.wrap {
        try await c.download(remote: req.remote, relay: req.relay?.isEmpty == false ? req.relay : nil, path: req.path, headers: Self.headers(req.headers), dest: path, timeoutMs: UInt64(req.timeoutMs))
      }
      return ["status": Int(info.status), "headers": Self.toJs(info.headers)]
    }

    AsyncFunction("close") { () async in
      let (c, pending) = self.lock.withLock { () -> (IrohClient?, [Pending]) in
        let r = (self.client, Array(self.responses.values)); self.client = nil; self.responses.removeAll(); return r
      }
      pending.forEach { $0.response.cancel() }
      await c?.shutdown()
    }
  }
}
