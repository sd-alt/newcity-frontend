export type MapSymbolKind =
  | 'sensor'
  | 'satellite'
  | 'uav'
  | 'station'
  | 'vehicle'
  | 'data'
  | 'task'
  | 'indicator'
  | 'target'
  | 'association'
  | 'coverage'
  | 'algorithm'

export const MAP_SYMBOL_PATHS: Record<MapSymbolKind, string[]> = {
  sensor: [
    'M12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    'M7.8 15.8a5.5 5.5 0 0 1 0-7.6',
    'M5.2 18.4a9 9 0 0 1 0-12.8',
    'M12 13v7',
  ],
  satellite: [
    'm8.4 15.6 7.2-7.2',
    'm9.7 9.7 4.6 4.6',
    'm7.2 11-3-3 3.1-3.1 3 3',
    'm16.8 13 3 3-3.1 3.1-3-3',
  ],
  uav: [
    'M8 10h8l2 4H6l2-4Z',
    'M12 14v5',
    'M5 7h4m6 0h4',
    'M7 5v4m10-4v4',
  ],
  station: [
    'M12 4v4M9 20l3-12 3 12M8 14h8',
    'M7 10a5 5 0 0 1 10 0',
    'M4.5 8.5a8 8 0 0 1 15 0',
  ],
  vehicle: [
    'M5 14v-3l2-4h10l2 4v3',
    'M4 14h16v4H4Z',
    'M7 18v2m10-2v2',
  ],
  data: [
    'M5 6c0-1.5 3.1-2.7 7-2.7S19 4.5 19 6s-3.1 2.7-7 2.7S5 7.5 5 6Z',
    'M5 6v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V6',
    'M5 12v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6',
  ],
  task: [
    'M8 5h8m-6-2h4v4h-4Z',
    'M7 5H5v16h14V5h-2',
    'm8 14 2 2 4-5',
  ],
  indicator: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
    'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  ],
  target: [
    'M6 21V4',
    'M6 5h11l-2.5 3L17 11H6',
  ],
  association: [
    'M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'm8.5 9.5 7 5',
  ],
  coverage: [
    'm12 3 8 5v8l-8 5-8-5V8Z',
    'm4 8 8 5 8-5',
  ],
  algorithm: [
    'm12 3 7 4v10l-7 4-7-4V7Z',
    'M8.5 9.5h7m-7 5h7M12 9.5v5',
  ],
}

export function platformMapSymbol(typeCode: unknown): MapSymbolKind {
  const code = String(typeCode || '').toLowerCase()
  if (code.includes('satellite') || code.includes('space') || code.includes('卫星')) return 'satellite'
  if (code.includes('uav') || code.includes('drone') || code.includes('无人机')) return 'uav'
  if (code.includes('station') || code.includes('ground') || code.includes('台站')) return 'station'
  if (
    code.includes('vehicle') ||
    code.includes('robot') ||
    code.includes('mobile') ||
    code.includes('车') ||
    code.includes('机器人')
  ) return 'vehicle'
  return 'sensor'
}

const markerCache = new Map<string, string>()

export function createMapMarkerDataUri(kind: MapSymbolKind, color: string): string {
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#475569'
  const cacheKey = `${kind}:${safeColor}`
  const cached = markerCache.get(cacheKey)
  if (cached) return cached
  const paths = MAP_SYMBOL_PATHS[kind]
    .map((path) => `<path d="${path}"/>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14.5" fill="white" stroke="#cbd5e1"/><circle cx="16" cy="16" r="11.5" fill="${safeColor}"/><g transform="translate(4 4)" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  markerCache.set(cacheKey, uri)
  return uri
}
