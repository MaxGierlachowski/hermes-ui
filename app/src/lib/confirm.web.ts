// Web / desktop variant of confirm.ts: the browser's dialogs (WKWebView shows them as sheets).
export const confirm = async (title: string, message: string, _action: string) => window.confirm(`${title}\n\n${message}`)
export const notice = (title: string, message: string) => window.alert(`${title}\n\n${message}`)
