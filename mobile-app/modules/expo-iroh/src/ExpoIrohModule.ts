import { requireNativeModule } from 'expo'

export type HeaderPairs = [string, string][]
export type NativeRequest = {
  remote: string
  relay?: string | null
  method?: string
  path: string
  headers?: HeaderPairs
  body?: string | null
  timeoutMs?: number
}
export type NativeHead = { id: number; status: number; headers: HeaderPairs }

type ExpoIrohNative = {
  libraryInfo(): string
  create(relayUrl: string | null, secretKey: string | null): Promise<{ endpointId: string; secretKey: string }>
  endpointId(): string | null
  relayProblem(): string | null
  connectionInfo(remote: string): string | null
  connect(remote: string, relay: string | null, timeoutMs: number): Promise<void>
  request(req: NativeRequest): Promise<NativeHead>
  read(id: number): Promise<Uint8Array | null>
  readText(id: number): Promise<string | null>
  text(id: number): Promise<string>
  cancel(id: number): void
  download(req: NativeRequest, dest: string): Promise<{ status: number; headers: HeaderPairs }>
  close(): Promise<void>
  /** Android only: foreground service that keeps the process (and connection) alive in the background. */
  startKeepAlive?(title: string, text: string): boolean
  updateKeepAlive?(title: string, text: string): void
  stopKeepAlive?(): void
  keepAliveRunning?(): boolean
}

export default requireNativeModule<ExpoIrohNative>('ExpoIroh')
