import { useMemo } from 'react'
import { Languages, Moon, Plus, Smartphone, Sun, Workflow } from 'lucide-react'
import { useTheme } from 'next-themes'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'
import { openThread, setFilter, useBoard } from '@/lib/store'
import { relTime } from '@/lib/format'
import { StatusDot, SourceIcon } from '@/components/board/status'
import { t, lang, setLang } from '@/lib/i18n'

export function CommandMenu({ open, onOpenChange, onNew, onRemote }: { open: boolean; onOpenChange: (o: boolean) => void; onNew: () => void; onRemote: () => void }) {
  const sessions = useBoard((s) => s.sessions)
  const system = useBoard((s) => s.system)
  const { resolvedTheme, setTheme } = useTheme()
  const list = useMemo(() => Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200), [sessions])
  const run = (fn: () => void) => { onOpenChange(false); fn() }
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('Befehle')} description={t('Sessions suchen oder Befehl ausführen')}>
      <CommandInput placeholder={t('Session suchen oder Befehl …')} />
      <CommandList>
        <CommandEmpty>{t('Nichts gefunden.')}</CommandEmpty>
        <CommandGroup heading={t('Aktionen')}>
          <CommandItem onSelect={() => run(onNew)}><Plus />{t('Neuer Chat')}<CommandShortcut>N</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => run(() => setFilter({ system: !system }))}><Workflow />{system ? t('Cron/System ausblenden') : t('Cron/System einblenden')}</CommandItem>
          <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}>{resolvedTheme === 'dark' ? <Sun /> : <Moon />}{t('Theme wechseln')}</CommandItem>
          <CommandItem onSelect={() => setLang(lang === 'de' ? 'en' : 'de')}><Languages />{lang === 'de' ? t('Sprache: English') : t('Sprache: Deutsch')}</CommandItem>
          <CommandItem onSelect={() => run(onRemote)}><Smartphone />{t('Fernzugriff & Geräte')}</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t('Sessions')}>
          {list.map((s) => (
            <CommandItem key={s.id} value={`${s.title} ${s.initialPrompt} ${s.source} ${s.id}`} onSelect={() => run(() => openThread(s.id))}>
              <StatusDot column={s.column} pending={!!s.pending?.length} />
              <span className="truncate">{s.title}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <SourceIcon source={s.source} className="size-3" />{relTime(s.updatedAt)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
