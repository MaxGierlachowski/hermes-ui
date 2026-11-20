// Horizontal pager for the board's columns on a phone: native ViewPager (Android) / UIPageViewController
// (iOS) through react-native-pager-view. Web: Pager.web.tsx (CSS scroll snap, same props).
import { forwardRef, useMemo, type ReactNode } from 'react'
import { Animated } from 'react-native'
import PagerView from 'react-native-pager-view'

export type PagerHandle = { setPage(i: number): void; setPageWithoutAnimation(i: number): void }
type Props = { initialPage: number; position: Animated.Value; offset: Animated.Value; onPageSelected: (i: number) => void; children: ReactNode[] }

const AnimatedPager = Animated.createAnimatedComponent(PagerView)

export const Pager = forwardRef<PagerHandle, Props>(function Pager({ initialPage, position, offset, onPageSelected, children }, ref) {
  // The tab underline follows the finger: driven natively by the pager's scroll position.
  const onPageScroll = useMemo(() => Animated.event([{ nativeEvent: { position, offset } }], { useNativeDriver: true }), [])
  return (
    <AnimatedPager
      ref={ref as never}
      style={{ flex: 1 }}
      initialPage={initialPage}
      offscreenPageLimit={children.length - 1}
      onPageScroll={onPageScroll}
      onPageSelected={(e: { nativeEvent: { position: number } }) => onPageSelected(e.nativeEvent.position)}
    >
      {children}
    </AnimatedPager>
  )
})
