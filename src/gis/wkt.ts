import * as wellknown from 'wellknown'

export type SimpleGeometry = {
  type: string
  coordinates: unknown
}

export function wktToGeoJson(wkt: string | null | undefined): SimpleGeometry | null {
  if (!wkt) return null
  try {
    const parse = (wellknown as unknown as { default?: (s: string) => unknown }).default
      ?? (wellknown as unknown as (s: string) => unknown)
    const parsed = parse(wkt) as
      | SimpleGeometry
      | { type: 'Feature'; geometry: SimpleGeometry }
      | null
    if (!parsed) return null
    if ((parsed as { type?: string }).type === 'Feature') {
      return (parsed as { geometry: SimpleGeometry }).geometry
    }
    return parsed as SimpleGeometry
  } catch {
    return null
  }
}
