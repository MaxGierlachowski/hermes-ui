/**
 * Path of the service worker. Normally it sits next to index.html (resolved against the document base,
 * which the backend sets to {HERMES_UI_BASE_PATH}/ when it serves the UI, so the worker's scope is the
 * base path). The GitHub Pages build serves the UI
 * from /app/ below a landing page but keeps the worker one level up (VITE_SW_PATH='../'), so installs
 * from before the move keep their registration, and with it their Web Push subscription.
 */
export const swUrl = () => new URL(`${import.meta.env.VITE_SW_PATH || './'}sw.js`, document.baseURI).pathname
