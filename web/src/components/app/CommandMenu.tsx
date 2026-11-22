import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, BellRing, Bot, Check, CornerDownLeft, Inbox, Languages, LayoutGrid, MessagesSquare, Moon, Plus, Smartphone, Sun, Tag, Workflow } from 'lucide-react'
import { useTheme } from 'next-themes'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { openLabelsDialog, openThread, searchChats, setFilter, setTab, toggleLabelFilter, useBoard, type SearchHit } from '@/lib/store'
import { relTime } from '@/lib/format'
import { COLUMNS, type Session } from '@/lib/types'
import { COLUMN_COLOR, SourceIcon, StatusDot } from '@/components/board/status'
import { cn } from '@/lib/utils'
import { t, lang, setLang } from '@/lib/i18n'

type Action = { id: string; label: string; icon: ReactNode; run: () => void; shortcut?: string; keep?: boolean }

/** Floating search: chats by title and content (Hermes' full-text index), plus the app's actions. */
export function CommandMenu({ open, onOpenChange, onNew, onRemote, onNotifications }: { open: boolean; onOpenChange: (o: boolean) => void; onNew: () => void; onRemote: () => void; onNotifications: () => void }) {
  const sessions = useBoard((s) => s.sessions)
  const system = useBoard((s) => s.system)
  const labels = useBoard((s) => s.labels)
  const labelFilter = useBoard((s) => s.labelFilter)
  const { resolvedTheme, setTheme } = useTheme()
  const [q, setQ] = useState('')
  const [archived, setArchived] = useState(false)
  const [res, setRes] = useState<{ q: string; title: SearchHit[]; content: SearchHit[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const query = q.trim()

  useEffect(() => { if (!open) { setQ(''); setRes(null) } }, [open])
  // Debounced; a newer query aborts the request of the previous one.
  useEffect(() => {
    if (!query) { setRes(null); setBusy(false); return }
    const ctl = new AbortController()
    setBusy(true)
    const timer = setTimeout(() => {
      searchChats(query, archived, ctl.signal)
        .then((r) => { setRes(r); setBusy(false) })
        .catch(() => { if (!ctl.signal.aborted) setBusy(false) })
    }, 160)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [query, archived])

  const close = (fn: () => void) => { onOpenChange(false); fn() }
  const actions: Action[] = [
    { id: 'new', label: t('Neuer Chat'), icon: <Plus />, run: onNew, shortcut: 'N' },
    { id: 'board', label: t('Zum Board'), icon: <LayoutGrid />, run: () => setTab('board'), shortcut: 'G B' },
    { id: 'inbox', label: t('Zur Inbox'), icon: <Inbox />, run: () => setTab('inbox'), shortcut: 'G I' },
    { id: 'notify', label: t('Benachrichtigungen …'), icon: <BellRing />, run: onNotifications },
    { id: 'sys', label: system ? t('Cron/System ausblenden') : t('Cron/System einblenden'), icon: <Workflow />, run: () => setFilter({ system: !system }) },
    { id: 'theme', label: t('Theme wechseln'), icon: resolvedTheme === 'dark' ? <Sun /> : <Moon />, run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark') },
    { id: 'lang', label: lang === 'de' ? t('Sprache: English') : t('Sprache: Deutsch'), icon: <Languages />, run: () => setLang(lang === 'de' ? 'en' : 'de'), keep: true },
    { id: 'remote', label: t('Fernzugriff & Geräte'), icon: <Smartphone />, run: onRemote },
    { id: 'labels', label: t('Labels verwalten …'), icon: <Tag />, run: () => openLabelsDialog() },
    ...labels.map((l) => ({
      id: `label:${l.id}`,
      label: t('Nach Label filtern: {name}', { name: l.name }),
      icon: labelFilter.includes(l.id) ? <Check /> : <span className="m-0.5 size-3 rounded-full" style={{ backgroundColor: l.color }} />,
      run: () => { setTab('board'); toggleLabelFilter(l.id) },
    })),
  ]
  const shownActions = query ? actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase())) : actions
  const recent = useMemo(() => Object.values(sessions).filter((s) => !s.draft).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [sessions])
  // Content hits whose title also matched are shown once, under "Titel", with their snippet.
  const contentById = useMemo(() => new Map((res?.content || []).map((h) => [h.session.id, h])), [res])
  const titleHits = (res?.title || []).map((h) => contentById.get(h.session.id) || h)
  const contentHits = (res?.content || []).filter((h) => !h.alsoTitle)
  const stale = !!res && res.q !== query
  const nothing = !!res && !stale && !busy && !titleHits.length && !contentHits.length && !shownActions.length

  const openHit = (h: SearchHit) => close(() => openThread(h.session.id, { highlight: h.hit?.msgId, query, session: h.session }))

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Suche')}
      description={t('Chats und Inhalte durchsuchen oder Befehl ausführen')}
      className="top-[max(0.5rem,env(safe-area-inset-top))] w-[calc(100%-1rem)] max-w-2xl translate-y-0 sm:top-[14vh] sm:max-w-2xl max-md:inset-0 max-md:top-0 max-md:left-0 max-md:flex max-md:h-(--visual-height) max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:flex-col max-md:rounded-none! max-md:pt-[env(safe-area-inset-top)] max-md:ring-0 max-md:data-open:zoom-in-100 max-md:data-closed:zoom-out-100"
      commandProps={{ shouldFilter: false, loop: true, className: 'rounded-xl! p-0 max-md:rounded-none! max-md:min-h-0 max-md:flex-1' }}
    >
      {/* Phones: full-screen search, with "Abbrechen" next to the field like the iOS search bar. */}
      <div className="flex items-center max-md:gap-1 max-md:pr-1">
        <div className="relative min-w-0 flex-1">
          <CommandInput value={q} onValueChange={setQ} placeholder={t('Chats, Inhalte oder Befehle suchen …')} className="h-10 text-[15px] touch:h-11 touch:text-base" />
          {busy && <Loader variant="circular" size="sm" className="absolute right-4 top-1/2 size-4 -translate-y-1/2" />}
        </div>
        <Button variant="ghost" size="sm" className="shrink-0 text-[15px] text-primary md:hidden" onClick={() => onOpenChange(false)}>{t('Abbrechen')}</Button>
      </div>
      <CommandList className="max-h-[min(62dvh,34rem)] px-1 pb-1 max-md:max-h-none max-md:flex-1 max-md:overscroll-contain">
        {nothing && <CommandEmpty>{t('Nichts gefunden für „{q}“.', { q: query })}</CommandEmpty>}

        {!query && recent.length > 0 && (
          <CommandGroup heading={t('Zuletzt aktiv')}>
            {recent.map((s) => <ResultItem key={s.id} session={s} onSelect={() => close(() => openThread(s.id))} />)}
          </CommandGroup>
        )}

        {titleHits.length > 0 && (
          <CommandGroup heading={t('Titel')}>
            {titleHits.map((h) => <ResultItem key={`t-${h.session.id}`} session={h.session} hit={h.hit} query={query} onSelect={() => openHit(h)} />)}
          </CommandGroup>
        )}
        {contentHits.length > 0 && (
          <CommandGroup heading={t('Inhalt')}>
            {contentHits.map((h) => <ResultItem key={`c-${h.session.id}`} session={h.session} hit={h.hit} onSelect={() => openHit(h)} />)}
          </CommandGroup>
        )}

        {shownActions.length > 0 && (
          <>
            {(query ? titleHits.length + contentHits.length > 0 : recent.length > 0) && <CommandSeparator className="my-1" />}
            <CommandGroup heading={t('Aktionen')}>
              {shownActions.map((a) => (
                <CommandItem key={a.id} value={`action-${a.id}`} onSelect={() => (a.keep ? a.run() : close(a.run))}>
                  {a.icon}{a.label}{a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-md:text-[13px] [.keyboard-open_&]:pb-2">
        <label className="flex items-center gap-1.5 max-md:min-h-11 max-md:gap-2.5">
          <Switch checked={archived} onCheckedChange={setArchived} className="scale-75 touch:scale-100" />
          <Archive className="size-3" />{t('Archivierte einbeziehen')}
        </label>
        <span className="ml-auto hidden items-center gap-3 sm:flex">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> {t('wählen')}</span>
          <span><Kbd><CornerDownLeft className="size-2.5" /></Kbd> {t('öffnen')}</span>
          <span><Kbd>esc</Kbd> {t('schließen')}</span>
        </span>
      </div>
    </CommandDialog>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-sans text-[10px]">{children}</kbd>
}

function ResultItem({ session: s, hit, query, onSelect }: { session: Session & { archived?: boolean }; hit?: SearchHit['hit']; query?: string; onSelect: () => void }) {
  const col = COLUMNS.find((c) => c.id === s.column)
  const agents = s.paseo?.length || 0
  return (
    <CommandItem value={`s-${s.id}`} onSelect={onSelect} className="items-start gap-3 py-2 [&>svg:last-child]:hidden">
      <StatusDot column={s.column} running={s.running} pending={!!s.pending?.length} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium">{query ? <Marked text={s.title} terms={query} /> : s.title}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{relTime(s.updatedAt)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><SourceIcon source={s.source} className="size-3" />{s.source}</span>
          {col && <span className="inline-flex items-center gap-1"><span className={cn('size-1.5 rounded-full', COLUMN_COLOR[s.column])} />{col.label}</span>}
          {s.messageCount > 0 && <span className="inline-flex items-center gap-1"><MessagesSquare className="size-3" />{s.messageCount}</span>}
          {agents > 0 && <span className="inline-flex items-center gap-1"><Bot className="size-3" />{agents}</span>}
          {s.archived && <span className="inline-flex items-center gap-1"><Archive className="size-3" />{t('archiviert')}</span>}
          {hit && hit.hits > 1 && <span>{t('{n} Treffer', { n: hit.hits })}</span>}
        </div>
        {hit?.snippet && (
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            <span className="mr-1 font-medium text-foreground/70">{hit.role === 'user' ? t('Du') : hit.role === 'event' ? t('Event') : 'Hermes'}:</span>
            <Snippet text={hit.snippet} />
          </div>
        )}
      </div>
    </CommandItem>
  )
}

const MARK = 'rounded-sm bg-amber-300/50 px-0.5 text-foreground dark:bg-amber-400/30'

/** Backend snippets mark hits with \u0002 … \u0003. */
function Snippet({ text }: { text: string }) {
  // oxlint-disable-next-line no-control-regex -- the markers are control characters on purpose
  const parts = text.replace(/\s+/g, ' ').split(/(\u0002[^\u0003]*\u0003)/)
  return <>{parts.map((p, i) => (p.startsWith('\u0002') ? <mark key={i} className={MARK}>{p.slice(1, -1)}</mark> : <Fragment key={i}>{p}</Fragment>))}</>
}

function Marked({ text, terms }: { text: string; terms: string }) {
  const words = terms.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length) return <>{text}</>
  const re = new RegExp(`(${words.join('|')})`, 'gi')
  return <>{text.split(re).map((p, i) => (i % 2 ? <mark key={i} className={MARK}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>
}
