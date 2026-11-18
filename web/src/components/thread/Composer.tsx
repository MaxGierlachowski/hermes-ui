import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Mic, Paperclip, Square, X } from 'lucide-react'
import { toast } from 'sonner'
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from '@/components/ui/prompt-input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fileToUpload } from '@/lib/api'
import type { OutgoingMessage } from '@/lib/types'
import { t } from '@/lib/i18n'
import { haptic } from '@/lib/haptics'
import { useTouchUI } from '@/hooks/use-touch'

type Img = { file: File; url: string }

// Unsent text per chat, kept while the thread is closed (a sheet swiped away by accident loses nothing).
const drafts = new Map<string, string>()
type Voice = { blob: Blob; url: string; seconds: number }

export function Composer({
  onSubmit,
  placeholder = t('Nachricht an Hermes …'),
  autoFocus,
  footer,
  className,
  onStop,
  draftKey,
}: {
  onSubmit: (m: OutgoingMessage) => Promise<unknown>
  placeholder?: string
  autoFocus?: boolean
  footer?: React.ReactNode
  className?: string
  /** Touch layout: while Hermes works and the field is empty, the send button stops the turn. */
  onStop?: () => void
  /** Keep unsent text under this key when the composer unmounts (e.g. the chat's id). */
  draftKey?: string
}) {
  const touch = useTouchUI()
  const [text, setTextState] = useState(() => (draftKey && drafts.get(draftKey)) || '')
  const setText = (v: string) => { setTextState(v); if (draftKey) { if (v) drafts.set(draftKey, v); else drafts.delete(draftKey) } }
  const [images, setImages] = useState<Img[]>([])
  const [voice, setVoice] = useState<Voice | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [rec, setRec] = useState<{ r: MediaRecorder; started: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - rec.started) / 1000)), 250)
    return () => clearInterval(t)
  }, [rec])

  const addFiles = (files: FileList | File[]) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/')).map((file) => ({ file, url: URL.createObjectURL(file) }))
    if (imgs.length) setImages((x) => [...x, ...imgs])
  }

  const toggleRecording = async () => {
    if (rec) { rec.r.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      const started = Date.now()
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setRec(null)
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' })
        if (blob.size < 1000) { toast.error(t('Aufnahme ist leer – Mikrofon prüfen')); return }
        setVoice({ blob, url: URL.createObjectURL(blob), seconds: Math.round((Date.now() - started) / 1000) })
      }
      r.start(250)
      setElapsed(0)
      setRec({ r, started })
    } catch (err) {
      toast.error(t('Mikrofon nicht verfügbar: {err}', { err: err instanceof Error ? err.message : String(err) }))
    }
  }

  const submit = async () => {
    if (rec) { rec.r.stop(); return }
    if (busy || (!text.trim() && !images.length && !voice)) return
    setBusy(true)
    haptic()
    try {
      await onSubmit({
        text: text.trim(),
        images: await Promise.all(images.map((i) => fileToUpload(i.file, i.file.name || 'image.png'))),
        audio: voice ? await fileToUpload(voice.blob, 'voice') : null,
      })
      setText('')
      setImages([])
      setVoice(null)
    } catch (err) {
      if (err instanceof Error && err.message !== 'abgebrochen') toast.error(t('Senden fehlgeschlagen: {err}', { err: err.message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn('relative', className)}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) } }}
    >
      <PromptInput value={text} onValueChange={setText} onSubmit={submit} isLoading={busy} className={cn('rounded-xl bg-card', touch && 'rounded-[1.375rem] p-1', dragging && 'ring-2 ring-primary')}>
        {(images.length > 0 || voice) && (
          <div className="flex flex-wrap gap-2 px-1 pb-2">
            {images.map((img, i) => (
              <div key={img.url} className="group relative">
                <img src={img.url} alt="" className="size-14 rounded-md object-cover ring-1 ring-border" />
                <button type="button" aria-label={t('Bild entfernen')} onClick={() => setImages((x) => x.filter((_, j) => j !== i))} className="touch-hitbox absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-0.5 text-background opacity-90 touch:-right-2 touch:-top-2 touch:p-1">
                  <X className="size-3 touch:size-3.5" />
                </button>
              </div>
            ))}
            {voice && (
              <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 ring-1 ring-border touch:w-full touch:rounded-xl touch:py-0 touch:pr-0">
                <audio controls src={voice.url} className="h-8 w-48 touch:h-11 touch:min-w-0 touch:flex-1" />
                <span className="text-xs tabular-nums text-muted-foreground">{voice.seconds}s</span>
                <button type="button" aria-label={t('Sprachnachricht entfernen')} onClick={() => setVoice(null)} className="touch:grid touch:size-11 touch:place-items-center"><X className="size-3.5 touch:size-4" /></button>
              </div>
            )}
          </div>
        )}
        {touch ? (
          <TouchRow
            rec={rec}
            elapsed={elapsed}
            canSend={!!(text.trim() || images.length || voice)}
            busy={busy}
            onAttach={() => fileRef.current?.click()}
            onMic={toggleRecording}
            onSend={submit}
            onStop={onStop}
            footer={footer}
          >
            <PromptInputTextarea
              autoFocus={autoFocus}
              submitOnEnter={false}
              enterKeyHint="enter"
              placeholder={rec ? t('Aufnahme läuft …') : placeholder}
              onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files) } }}
              className="min-h-11 px-1 py-2.5 text-base leading-6 dark:bg-transparent"
            />
          </TouchRow>
        ) : (<>
        <PromptInputTextarea
          autoFocus={autoFocus}
          placeholder={rec ? t('Aufnahme läuft …') : placeholder}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files) } }}
          className="min-h-11 text-sm"
        />
        <PromptInputActions className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1">
            <PromptInputAction tooltip={t('Bild anhängen')}>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => fileRef.current?.click()} aria-label={t('Bild anhängen')}>
                <Paperclip className="size-4" />
              </Button>
            </PromptInputAction>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
            <PromptInputAction tooltip={rec ? t('Aufnahme stoppen') : t('Sprachnachricht')}>
              <Button type="button" variant={rec ? 'destructive' : 'ghost'} size="icon-sm" onClick={toggleRecording} aria-label={rec ? t('Aufnahme stoppen') : t('Sprachnachricht aufnehmen')} data-testid="mic">
                {rec ? <Square className="size-3.5" /> : <Mic className="size-4" />}
              </Button>
            </PromptInputAction>
            {rec && <span className="text-xs tabular-nums text-destructive">● {elapsed}s</span>}
            {footer}
          </div>
          <Button type="button" size="icon-sm" className="rounded-full" disabled={busy || (!text.trim() && !images.length && !voice && !rec)} onClick={submit} aria-label={t('Senden')} data-testid="send">
            <ArrowUp className="size-4" />
          </Button>
        </PromptInputActions>
        </>)}
        {touch && <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />}
      </PromptInput>
      <p className="mt-1 hidden px-1 text-[11px] text-muted-foreground sm:block">{t('↵ senden · ⇧↵ neue Zeile · Bilder per Einfügen oder Drag & Drop')}</p>
    </div>
  )
}

/**
 * Touch layout (phones, tablets): one row like the native chat apps. Attach on the left, the field grows
 * in the middle, and one round button on the right that is the mic while the field is empty, send once
 * there is something to send, stop while recording, and stop-the-turn while Hermes works (if allowed).
 * Every button is at least 44 px to hit.
 */
function TouchRow({ rec, elapsed, canSend, busy, onAttach, onMic, onSend, onStop, footer, children }: {
  rec: unknown
  elapsed: number
  canSend: boolean
  busy: boolean
  onAttach: () => void
  onMic: () => void
  onSend: () => void
  onStop?: () => void
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const round = 'touch-hitbox size-10 shrink-0 rounded-full touch:size-10 [&_svg]:size-5'
  return (
    // Taps on the buttons must not also focus the field (that would pop up the keyboard).
    <div className="flex items-end gap-0.5" onClick={(e) => { if ((e.target as HTMLElement).closest('button')) e.stopPropagation() }}>
      <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full text-muted-foreground [&_svg]:size-5" onClick={onAttach} aria-label={t('Bild anhängen')} data-testid="attach">
        <Paperclip />
      </Button>
      <div className="min-w-0 flex-1">{children}</div>
      {rec ? <span className="self-center px-1 text-xs tabular-nums text-destructive">● {elapsed}s</span> : null}
      {footer}
      <div className="grid size-11 shrink-0 place-items-center">
        {rec ? (
          <Button type="button" variant="destructive" size="icon" className={round} onClick={onMic} aria-label={t('Aufnahme stoppen')} data-testid="mic"><Square className="size-4!" /></Button>
        ) : canSend || busy ? (
          <Button type="button" size="icon" className={round} disabled={busy} onClick={onSend} aria-label={t('Senden')} data-testid="send"><ArrowUp /></Button>
        ) : onStop ? (
          <Button type="button" variant="secondary" size="icon" className={round} onClick={onStop} aria-label={t('Laufenden Turn stoppen')} data-testid="stop"><Square className="size-3.5! fill-current" /></Button>
        ) : (
          <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full text-muted-foreground [&_svg]:size-5" onClick={onMic} aria-label={t('Sprachnachricht aufnehmen')} data-testid="mic"><Mic /></Button>
        )}
      </div>
    </div>
  )
}
