export type BasemapKey = 'vector' | 'imagery' | 'terrain' | 'admin'

export type MapConfig = {
  defaultBasemap: BasemapKey
  basemaps: Record<
    BasemapKey,
    { name: string; type: string; url: string; credit: string; maxZoom?: number }
  >
  defaultView: { lon: number; lat: number; height: number }
  coordinateSystem: string
}

const fallback: MapConfig = {
  defaultBasemap: 'vector',
  basemaps: {
    vector: {
      name: '标准地图',
      type: 'urlTemplate',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: 'OpenStreetMap',
      maxZoom: 19,
    },
    imagery: {
      name: '卫星影像',
      type: 'urlTemplate',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: 'Esri',
      maxZoom: 19,
    },
    terrain: {
      name: '地形地图',
      type: 'urlTemplate',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      credit: 'Esri',
      maxZoom: 19,
    },
    admin: {
      name: '行政区划',
      type: 'urlTemplate',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      credit: 'Esri',
      maxZoom: 16,
    },
  },
  defaultView: { lon: 114.3, lat: 22.8, height: 800000 },
  coordinateSystem: 'EPSG:4326',
}

let cached: MapConfig | null = null

export async function loadMapConfig(): Promise<MapConfig> {
  if (cached) return cached
  try {
    const res = await fetch('/map-config.json', { cache: 'no-cache' })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as MapConfig
    cached = {
      ...fallback,
      ...data,
      basemaps: { ...fallback.basemaps, ...(data.basemaps || {}) },
      defaultView: { ...fallback.defaultView, ...(data.defaultView || {}) },
    }
  } catch {
    cached = fallback
  }
  return cached
}

export function getMapConfigSync(): MapConfig {
  return cached || fallback
}
