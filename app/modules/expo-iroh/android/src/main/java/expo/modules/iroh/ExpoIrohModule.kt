package expo.modules.iroh

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CharsetDecoder
import java.nio.charset.CodingErrorAction
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import uniffi.hermes_iroh.Header
import uniffi.hermes_iroh.IrohClient
import uniffi.hermes_iroh.IrohException
import uniffi.hermes_iroh.IrohResponse
import uniffi.hermes_iroh.libraryInfo

class RequestOptions : Record {
  @Field val remote: String = ""
  @Field val relay: String? = null
  @Field val method: String = "GET"
  @Field val path: String = "/"
  @Field val headers: List<List<String>> = emptyList()
  /** UTF-8 request body (the hermes-ui API is JSON only; images and audio travel base64 inside it). */
  @Field val body: String? = null
  @Field val timeoutMs: Double = 30_000.0
}

class IrohFailed(message: String) : CodedException("ERR_IROH", message, null)

/** A response whose body JS reads chunk by chunk; text reads keep one UTF-8 decoder across chunks. */
private class Pending(val response: IrohResponse) {
  val decoder: CharsetDecoder = Charsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPLACE)
    .onUnmappableCharacter(CodingErrorAction.REPLACE)
  var leftover: ByteArray = ByteArray(0)
}

/**
 * JS bridge to the Rust iroh-http/1 client (libhermes_iroh.so through UniFFI). One client endpoint
 * per app process; responses are handles (ids) so bodies can stream (SSE) without blocking anything.
 */
class ExpoIrohModule : Module() {
  private var client: IrohClient? = null
  private val clientLock = Mutex()
  private val responses = ConcurrentHashMap<Int, Pending>()
  private val nextId = AtomicInteger(1)

  private fun requireClient(): IrohClient = client ?: throw IrohFailed("iroh client not created")

  private inline fun <T> iroh(block: () -> T): T =
    try { block() } catch (e: IrohException) { throw IrohFailed(e.message ?: e.toString()) }

  private fun headersOf(list: List<List<String>>) = list.filter { it.size == 2 }.map { Header(it[0], it[1]) }
  private fun headersToJs(list: List<Header>) = list.map { listOf(it.name, it.value) }

  override fun definition() = ModuleDefinition {
    Name("ExpoIroh")

    Function("libraryInfo") { libraryInfo() }

    /** Creates the endpoint once; later calls return the existing one (same identity). */
    AsyncFunction("create") Coroutine { relayUrl: String?, secretKey: String? ->
      clientLock.withLock {
        val c = client ?: iroh { IrohClient.create(relayUrl?.ifEmpty { null }, null, secretKey?.ifEmpty { null }) }.also { client = it }
        mapOf("endpointId" to c.endpointId(), "secretKey" to c.secretKey())
      }
    }

    Function("endpointId") { client?.endpointId() }

    Function("relayProblem") { client?.relayProblem() }

    Function("connectionInfo") { remote: String -> iroh { client?.connectionInfo(remote) } }

    AsyncFunction("connect") Coroutine { remote: String, relay: String?, timeoutMs: Double ->
      iroh { requireClient().connect(remote, relay?.ifEmpty { null }, timeoutMs.toLong().toULong()) }
    }

    /** Resolves with the response head; read the body with read/readText/text, or cancel it. */
    AsyncFunction("request") Coroutine { req: RequestOptions ->
      val response = iroh {
        requireClient().request(
          req.remote, req.relay?.ifEmpty { null }, req.method, req.path, headersOf(req.headers),
          req.body?.toByteArray(Charsets.UTF_8) ?: ByteArray(0), req.timeoutMs.toLong().toULong(),
        )
      }
      val id = nextId.getAndIncrement()
      responses[id] = Pending(response)
      mapOf("id" to id, "status" to response.status().toInt(), "headers" to headersToJs(response.headers()))
    }

    /** The next body chunk as bytes, or null at the end (the handle is released then). */
    AsyncFunction("read") Coroutine { id: Int ->
      val p = responses[id] ?: return@Coroutine null
      val chunk = iroh { p.response.read() }
      if (chunk == null) responses.remove(id)?.response?.destroy()
      chunk
    }

    /** The next body chunk decoded as UTF-8 (multi-byte characters split across chunks stay intact). */
    AsyncFunction("readText") Coroutine { id: Int ->
      val p = responses[id] ?: return@Coroutine null
      val chunk = iroh { p.response.read() }
      if (chunk == null) {
        responses.remove(id)?.response?.destroy()
        return@Coroutine null
      }
      val bytes = if (p.leftover.isEmpty()) chunk else p.leftover + chunk
      val input = ByteBuffer.wrap(bytes)
      val out = CharBuffer.allocate(bytes.size + 1)
      p.decoder.decode(input, out, false)
      p.leftover = ByteArray(input.remaining()).also { input.get(it) }
      out.flip()
      out.toString()
    }

    /** The whole remaining body as UTF-8 text (JSON responses); releases the handle. */
    AsyncFunction("text") Coroutine { id: Int ->
      val p = responses.remove(id) ?: return@Coroutine ""
      try { String(iroh { p.response.bytes() }, Charsets.UTF_8) } finally { p.response.destroy() }
    }

    Function("cancel") { id: Int ->
      responses.remove(id)?.let { it.response.cancel(); it.response.destroy() }
      Unit
    }

    /** GET into a local file (images, audio), so <Image>/players can use a file:// URI. */
    AsyncFunction("download") Coroutine { req: RequestOptions, dest: String ->
      val path = dest.removePrefix("file://")
      val info = iroh {
        requireClient().download(req.remote, req.relay?.ifEmpty { null }, req.path, headersOf(req.headers), path, req.timeoutMs.toLong().toULong())
      }
      mapOf("status" to info.status.toInt(), "headers" to headersToJs(info.headers))
    }

    AsyncFunction("close") Coroutine { ->
      clientLock.withLock {
        responses.values.forEach { it.response.cancel(); it.response.destroy() }
        responses.clear()
        client?.shutdown()
        client?.destroy()
        client = null
      }
    }

    /**
     * Keep-alive: a foreground service (quiet ongoing notification) so Android does not freeze the
     * process in the background, and the connection keeps delivering. Start only from the foreground
     * (Android 12+ forbids starting it from the background); update and stop work any time.
     */
    Function("startKeepAlive") { title: String, text: String ->
      val ctx = appContext.reactContext ?: return@Function false
      val intent = Intent(ctx, KeepAliveService::class.java).putExtra(KeepAliveService.EXTRA_TITLE, title).putExtra(KeepAliveService.EXTRA_TEXT, text)
      try { ContextCompat.startForegroundService(ctx, intent); true } catch (e: Exception) { false }
    }

    Function("updateKeepAlive") { title: String, text: String ->
      val ctx = appContext.reactContext ?: return@Function Unit
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.activeNotifications.any { it.id == KeepAliveService.ID }) nm.notify(KeepAliveService.ID, KeepAliveService.build(ctx, title, text))
      Unit
    }

    Function("keepAliveRunning") { KeepAliveService.running }

    Function("stopKeepAlive") {
      appContext.reactContext?.let { it.stopService(Intent(it, KeepAliveService::class.java)) }
      Unit
    }

    OnDestroy {
      responses.values.forEach { it.response.cancel() }
      responses.clear()
    }
  }
}
