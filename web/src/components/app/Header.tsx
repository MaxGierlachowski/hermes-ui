import { Moon, Plus, Search, Smartphone, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { setFilter, useBoard } from '@/lib/store'
import { useMemo } from 'react'
import { t } from '@/lib/i18n'
import { HeaderTabs } from './AppTabs'

export function Header({ onNew, onCommand, onRemote }: { onNew: () => void; onCommand: () => void; onRemote: () => void }) {
  const { resolvedTheme, setTheme } = useTheme()
  const gateway = useBoard((s) => s.gateway)
  const live = useBoard((s) => s.live)
  const remote = useBoard((s) => s.remote)
  const days = useBoard((s) => s.days)
  const system = useBoard((s) => s.system)
  const tab = useBoard((s) => s.tab)
  const source = useBoard((s) => s.source)
  const sessions = useBoard((s) => s.sessions)
  const sources = useMemo(() => [...new Set(Object.values(sessions).map((s) => s.source))].sort(), [sessions])
  const ok = gateway && live

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-4">
      <div className="flex items-center gap-2">
        <div className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">H</div>
        <span className="text-sm font-semibold tracking-tight">Hermes UI</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn('size-1.5 rounded-full', ok ? 'bg-emerald-500' : gateway ? 'bg-amber-500' : 'bg-red-500')} aria-label={t('Verbindungsstatus')} />
          </TooltipTrigger>
          <TooltipContent>{ok ? 'Live mit dem Hermes-Gateway verbunden' : gateway ? 'Live-Stream unterbrochen' : t('Gateway nicht verbunden (nur Lesen)')}</TooltipContent>
        </Tooltip>
      </div>
      <HeaderTabs />

      <button
        onClick={onCommand}
        className="ml-2 hidden h-8 w-64 items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted md:flex"
      >
        <Search className="size-3.5" />{t('Suchen oder Befehl …')}<Kbd className="ml-auto">⌘K</Kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <div className={cn('hidden items-center gap-1.5', tab === 'board' && 'lg:flex')}>
          <Select value={source || 'all'} onValueChange={(v) => setFilter({ source: v === 'all' ? '' : v })}>
            <SelectTrigger size="sm" className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('Alle Quellen')}</SelectItem>
              {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setFilter({ days: Number(v) })}>
            <SelectTrigger size="sm" className="h-8 w-[92px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 3, 7, 30].map((d) => <SelectItem key={d} value={String(d)}>{d === 1 ? '24 h' : t('{n} Tage', { n: d })}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 px-1.5">
            <Switch id="sys" checked={system} onCheckedChange={(v) => setFilter({ system: v })} />
            <Label htmlFor="sys" className="text-xs font-normal text-muted-foreground">{t('Cron/System')}</Label>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onCommand} aria-label={t('Suchen')}><Search className="size-4" /></Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onRemote} aria-label={t('Fernzugriff')} className="relative">
              <Smartphone className="size-4" />
              {remote && remote.status !== 'off' && (
                <span className={cn('absolute right-1 top-1 size-1.5 rounded-full', remote.status === 'online' ? 'bg-emerald-500' : 'bg-amber-500')} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('Fernzugriff & Geräte')}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} aria-label={t('Hell/Dunkel')}>
          {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button size="sm" className="ml-1 hidden h-8 sm:inline-flex" onClick={onNew}><Plus className="size-4" />{t('Neuer Chat')}</Button>
      </div>
    </header>
  )
}
