// Web / desktop: no haptics (a trackpad has no taptic API for web pages). Same API as haptics.ts.
export const haptic = (_kind: 'tap' | 'select' | 'success' | 'warning' = 'tap') => {}
