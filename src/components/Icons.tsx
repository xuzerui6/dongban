export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    dumbbell: <><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    bag: <><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>,
    flame: <path d="M13 2s.5 4-2 6c-2.5 2-1 4-1 4s-4-2-3-6c0 0-5 6-2 12 2 4 6 4 7 4s7 0 8-7c.8-5-3-8-3-8s0 5-3 6c0 0 1-7-1-11Z"/>,
    bluetooth: <path d="m7 7 10 10-5 5V2l5 5L7 17"/>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    back: <><path d="M19 12H5M10 7l-5 5 5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    play: <path d="m7 4 13 8-13 8V4Z"/>,
    spark: <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z"/>,
    reset: <><path d="M4 4v6h6"/><path d="M5 15a8 8 0 1 0 1-9l-2 4"/></>,
    mic: <><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 19v3"/></>,
    micOff: <><path d="M15 8V5a3 3 0 0 0-5.9-.7M9 9v2a3 3 0 0 0 4.5 2.6"/><path d="M5 10v1a7 7 0 0 0 10.7 6M19 11v-1M12 19v3"/><path d="m3 3 18 18"/></>,
    volume: <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M16 9a3.5 3.5 0 0 1 0 6M19 6a7 7 0 0 1 0 12"/></>,
    volumeOff: <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m17 9 4 6M21 9l-4 6"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>
}
