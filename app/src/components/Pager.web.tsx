// Web variant of Pager.tsx: a horizontal scroller with CSS scroll snap, so a trackpad swipe or a
// touch swipe moves between columns with the browser's own physics. Same props and handle.
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react'
import { Animated, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native'
import type { PagerHandle } from './Pager'

export type { PagerHandle }
type Props = { initialPage: number; position: Animated.Value; offset: Animated.Value; onPageSelected: (i: number) => void; children: ReactNode[] }

export const Pager = forwardRef<PagerHandle, Props>(function Pager({ initialPage, position, offset, onPageSelected, children }, ref) {
  const scroller = useRef<ScrollViewInstance>(null)
  const width = useRef(useWindowDimensions().width)
  const page = useRef(initialPage)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  useImperativeHandle(ref, () => ({
    setPage: (i) => scroller.current?.scrollTo({ x: i * width.current, animated: true }),
    setPageWithoutAnimation: (i) => scroller.current?.scrollTo({ x: i * width.current, animated: false }),
  }))
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x / (width.current || 1)
    position.setValue(Math.floor(x))
    offset.setValue(x - Math.floor(x))
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const i = Math.round(x)
      if (i !== page.current) { page.current = i; onPageSelected(i) }
    }, 80)
  }
  return (
    <ScrollView
      ref={scroller}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onScroll}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width
        scroller.current?.scrollTo({ x: page.current * width.current, animated: false })
      }}
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      {children.map((c, i) => <View key={i} style={{ width: width.current, flex: 1 }}>{c}</View>)}
    </ScrollView>
  )
})
