import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { ThemeProvider, useTheme } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Board } from '@/components/board/Board'
import { ThreadView } from '@/components/thread/ThreadView'
import { Header } from '@/components/app/Header'
import { NewChatDialog } from '@/components/app/NewChatDialog'
import { CommandMenu } from '@/components/app/CommandMenu'
import { RemoteDialog } from '@/components/app/RemoteDialog'
import { Login } from '@/components/app/Login'
import { Inbox } from '@/components/inbox/Inbox'
import { NotificationSettings } from '@/components/inbox/NotificationSettings'
import { ConfirmApproval } from '@/components/inbox/ConfirmApproval'
import { BottomTabBar } from '@/components/app/AppTabs'
import { applyHash, setTab, bootstrap, connectEvents, loadInbox, loadRemote, loadSessions, openThread, useBoard } from '@/lib/store'
import { refreshPush, registration, startPresence } from '@/lib/push'
import { useIsMobile } from '@/hooks/use-mobile'
import { t } from '@/lib/i18n'

// Page background per theme (index.css --background). The installed PWA paints the status bar and the
// home-indicator area with theme-color, so it has to follow the app's theme, not only the system's.
const THEME_BG = { light: '#fafafa', dark: '#09090b' } as const

function ThemeColorSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (resolvedTheme !== 'light' && resolvedTheme !== 'dark') return
    for (const m of Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))) {
      m.removeAttribute('media')
      m.content = THEME_BG[resolvedTheme]
    }
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])
  return null
}

function Shell() {
  const auth = useBoard((s) => s.auth)
  const openId = useBoard((s) => s.openId)
  const tab = useBoard((s) => s.tab)
  const isMobile = useIsMobile()
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)

  useEffect(() => {
    bootstrap()
    // A pairing link opened while the UI is already open only changes the fragment: start over.
    const onHash = () => { if (/[#&]iroh=/.test(location.hash)) location.reload(); else applyHash() }
    window.addEventListener('hashchange', onHash)
    // A click on a push notification while the app is open: the service worker asks us to navigate.
    const onSw = (e: MessageEvent) => { if (e.data?.type === 'hermes-ui:navigate') applyHash(e.data.hash) }
    navigator.serviceWorker?.addEventListener('message', onSw)
    return () => { window.removeEventListener('hashchange', onHash); navigator.serviceWorker?.removeEventListener('message', onSw) }
  }, [])
  useEffect(() => {
    if (auth !== 'ok') return
    if (location.pathname === '/pair') history.replaceState(null, '', '/')
    loadSessions().then((ok) => {
      if (!ok) return
      connectEvents()
      loadRemote()
      loadInbox()
      applyHash()
      // The service worker (iroh bridge + push) also runs locally; then learn this device's push state.
      registration().then(() => refreshPush())
      startPresence()
    })
  }, [auth])
  useEffect(() => {
    let gAt = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen((o) => !o) }
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable
      if (!typing && !e.metaKey && !e.ctrlKey && e.key === 'n') { e.preventDefault(); setNewOpen(true) }
      if (!typing && !e.metaKey && !e.ctrlKey && e.key === '/') { e.preventDefault(); setCmdOpen(true) }
      // g b / g i: switch between Board and Inbox.
      if (!typing && !e.metaKey && !e.ctrlKey && gAt && Date.now() - gAt < 1000 && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); setTab(e.key === 'b' ? 'board' : 'inbox'); gAt = 0; return }
      gAt = !typing && e.key === 'g' && !e.metaKey && !e.ctrlKey ? Date.now() : 0
      // Escape in a dialog (lightbox, search) closes only that dialog, not the thread behind it:
      // Radix marks the Escape it handled with preventDefault().
      if (!typing && !e.defaultPrevented && e.key === 'Escape' && openId) openThread(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId])

  if (auth === 'required' || auth === 'no-backend' || location.pathname.endsWith('/pair')) return <Login />
  if (auth === 'unknown') return null

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Header onNew={() => setNewOpen(true)} onCommand={() => setCmdOpen(true)} onRemote={() => setRemoteOpen(true)} />
      <main className="min-h-0 flex-1">
        {isMobile ? (
          <>
            {tab === 'inbox' ? <Inbox onSettings={() => setNotifyOpen(true)} /> : <Board />}
            <Sheet open={!!openId} onOpenChange={(o) => !o && openThread(null)}>
              <SheetContent side="bottom" showCloseButton={false} className="h-[94dvh] max-h-[94dvh] rounded-t-xl p-0 data-[side=bottom]:h-[94dvh]">
                <SheetTitle className="sr-only">Thread</SheetTitle>
                <ThreadView />
              </SheetContent>
            </Sheet>
            {!openId && tab === 'board' && (
              <Button size="lg" className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] right-4 z-40 rounded-full shadow-lg" onClick={() => setNewOpen(true)}>
                <Plus className="size-4" />{t('Neuer Chat')}
              </Button>
            )}
          </>
        ) : (
          <ResizablePanelGroup orientation="horizontal" id="hk-layout">
            <ResizablePanel id="board" minSize="40" className="min-w-0">
              {tab === 'inbox' ? <Inbox onSettings={() => setNotifyOpen(true)} /> : <Board />}
            </ResizablePanel>
            {openId && (
              <>
                <ResizableHandle />
                <ResizablePanel id="thread" defaultSize="34" minSize="360px" maxSize="60" className="min-w-0 border-l">
                  <ThreadView />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}
      </main>
      <BottomTabBar />
      <NewChatDialog open={newOpen} onOpenChange={setNewOpen} />
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} onNew={() => setNewOpen(true)} onRemote={() => setRemoteOpen(true)} onNotifications={() => setNotifyOpen(true)} />
      <RemoteDialog open={remoteOpen} onOpenChange={setRemoteOpen} />
      <NotificationSettings open={notifyOpen} onOpenChange={setNotifyOpen} />
      <ConfirmApproval />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="hk_theme_v2" disableTransitionOnChange>
      <ThemeColorSync />
      <TooltipProvider delayDuration={300}>
        <Shell />
        <AppToaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}

/**
 * In-app notifications never cover a composer. Desktop: bottom left, over the board (it keeps at least
 * 40 % of the width; the thread panel and its input sit on the right), never wider than that share.
 * Mobile: above the bottom tab bar, or at the top while a thread sheet (input at the bottom) is open.
 */
function AppToaster() {
  const isMobile = useIsMobile()
  const threadOpen = useBoard((s) => !!s.openId)
  const top = isMobile && threadOpen
  return (
    <Toaster
      position={isMobile ? (top ? 'top-center' : 'bottom-center') : 'bottom-left'}
      mobileOffset={top ? { top: 'calc(0.5rem + env(safe-area-inset-top))' } : { bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
      style={{ '--width': 'min(356px, calc(40vw - 32px))' } as React.CSSProperties}
    />
  )
}
