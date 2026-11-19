// Voice recording in the browser and the desktop app (WKWebView): MediaRecorder directly.
// expo-audio's web recorder hands out a blob: URL, and reading that back with fetch() is a network
// request: the desktop app's CSP (connect-src) refused it, so a take never left the composer. Here
// the recording stays a Blob and is read with FileReader; the microphone is released after each take.
import { useEffect, useRef, useState } from 'react'
import type { Upload } from '@shared/types'
import { blobToBase64 } from './upload.web'
import type { StartResult, VoiceRecorder } from './recorder'

export type { StartResult, VoiceRecorder } from './recorder'

// WebKit (Safari, the desktop app) records MP4/AAC, Chromium and Firefox WebM/Opus.
const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }

type Take = { rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; done: Promise<Blob> }

export function useVoiceRecorder(): VoiceRecorder {
  const take = useRef<Take | null>(null)
  const [started, setStarted] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (started == null) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [started])
  // Unmounting mid-take (chat closed) must not leave the microphone on.
  useEffect(() => () => { take.current?.stream.getTracks().forEach((t) => t.stop()) }, [])

  const finish = async (keep: boolean) => {
    const cur = take.current
    take.current = null
    setStarted(null)
    if (!cur) return null
    if (cur.rec.state !== 'inactive') cur.rec.stop()
    const blob = await cur.done
    cur.stream.getTracks().forEach((t) => t.stop())
    return keep ? blob : null
  }

  return {
    recording: started != null,
    millis: started != null ? Math.max(0, now - started) : 0,
    async start(): Promise<StartResult> {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Audio recording is not available here')
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (e) {
        // The browser / WebKit refuses with NotAllowedError when the user or the system denied it.
        if (e instanceof Error && /NotAllowed|Permission|denied|Security/i.test(`${e.name} ${e.message}`)) return 'denied'
        throw e
      }
      const mimeType = TYPES.find((x) => MediaRecorder.isTypeSupported?.(x))
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      const done = new Promise<Blob>((resolve, reject) => {
        rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }
        rec.onstop = () => resolve(new Blob(chunks, { type: (rec.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0] }))
        rec.onerror = (e) => reject((e as unknown as { error?: Error }).error || new Error('recording failed'))
      })
      rec.start(250)
      take.current = { rec, stream, chunks, started: Date.now(), done }
      setNow(Date.now())
      setStarted(Date.now())
      return 'recording'
    },
    async stop(): Promise<Upload | null> {
      const blob = await finish(true)
      if (!blob || blob.size < 1000) return null
      const type = blob.type || 'audio/webm'
      return { name: `voice.${EXT[type] || 'webm'}`, type, data: await blobToBase64(blob) }
    },
    async cancel() { await finish(false) },
  }
}
