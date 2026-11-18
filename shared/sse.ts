// Incremental parser for text/event-stream (the backend's /api/events). Used where there is no
// EventSource: the native app reads the stream over its iroh module chunk by chunk.

export type SseEvent = { event: string; data: string; id?: string }

export class SseParser {
  private buf = ''
  private event = ''
  private data: string[] = []
  private id: string | undefined

  constructor(private onEvent: (e: SseEvent) => void) {}

  /** Feeds decoded text; complete events are delivered synchronously. */
  push(text: string) {
    this.buf += text
    let nl: number
    while ((nl = this.buf.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + (this.buf.startsWith('\r\n', nl) ? 2 : 1))
      this.line(line)
    }
  }

  private line(line: string) {
    if (line === '') {
      if (this.data.length) this.onEvent({ event: this.event || 'message', data: this.data.join('\n'), id: this.id })
      this.event = ''
      this.data = []
      return
    }
    if (line.startsWith(':')) return // comment / keep-alive
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.event = value
    else if (field === 'data') this.data.push(value)
    else if (field === 'id') this.id = value
  }
}
