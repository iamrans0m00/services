import { RoutePoint } from '../types'
import { FileInfo, getBindings } from '../../../api'
import { useUserSettings } from '../../../settings'

// ─── Surface entry from companion CSV ────────────────────────────────────────

export interface SurfaceEntry {
    distance: number   // metres from start
    surface: string    // RoadFeelSurface name (Road, Gravel, etc.)
}

// ─── Companion CSV parser ─────────────────────────────────────────────────────
// Format: distance_m,surface   (first line may be a header)
// Example:
//   0,Road
//   4200,Gravel
//   6800,Road

export function parseSurfaceFile(content: string): SurfaceEntry[] {
    const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
    const entries: SurfaceEntry[] = []

    for (const line of lines) {
        const parts = line.split(',')
        if (parts.length < 2) continue
        const distance = parseFloat(parts[0].trim())
        const surface = parts.slice(1).join(',').trim()
        if (isNaN(distance) || !surface) continue
        entries.push({ distance, surface })
    }

    return entries.sort((a, b) => a.distance - b.distance)
}

// Apply CSV surface entries to route points (assumes points sorted by routeDistance)
export function applySurfacesToPoints(points: RoutePoint[], entries: SurfaceEntry[]): void {
    if (!entries.length) return

    let entryIdx = 0
    for (const point of points) {
        // Advance to last entry whose distance <= point.routeDistance
        while (entryIdx + 1 < entries.length && point.routeDistance >= entries[entryIdx + 1].distance) {
            entryIdx++
        }
        point.surface = entries[entryIdx].surface
    }
}

// Try to load a companion .surfaces.csv file next to the GPX
export async function tryLoadCompanionSurface(
    fileInfo: FileInfo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader: any
): Promise<SurfaceEntry[] | null> {
    if (!fileInfo || !fileInfo.dir || !fileInfo.name) return null

    const { dir, name, delimiter } = fileInfo
    const companionBase = name + '.surfaces.csv'
    const companionFilename = dir + delimiter + companionBase

    const companionFile: FileInfo = {
        ...fileInfo,
        ext: 'csv',
        base: companionBase,
        filename: companionFilename,
    }

    try {
        const res = await loader.open(companionFile)
        if (res?.error || !res?.data) return null
        const entries = parseSurfaceFile(res.data)
        return entries.length > 0 ? entries : null
    } catch {
        return null
    }
}

// ─── OSM Overpass enrichment ──────────────────────────────────────────────────

const OSM_OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Map OSM surface tags → RoadFeelSurface names
const OSM_SURFACE_MAP: Record<string, string> = {
    asphalt: 'Road',
    paved: 'Road',
    concrete: 'Road',
    tarmac: 'Road',
    cobblestone: 'CobblestoneHard',
    'cobblestone:flattened': 'CobblestoneEasy',
    sett: 'CobblestoneEasy',
    paving_stones: 'BrickRoad',
    bricks: 'BrickRoad',
    gravel: 'Gravel',
    compacted: 'Gravel',
    fine_gravel: 'GravelLight',
    unpaved: 'GravelDeep',
    ground: 'GravelDeep',
    dirt: 'GravelDeep',
    earth: 'GravelDeep',
    wood: 'WoodenPlanks',
    boardwalk: 'WoodenPlanks',
    ice: 'Ice',
    snow: 'Snow',
}

export function osmTagToSurface(tag?: string): string {
    if (!tag) return 'Road'
    return OSM_SURFACE_MAP[tag.toLowerCase()] ?? 'Road'
}

function dist2(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dlat = lat1 - lat2
    const dlng = lng1 - lng2
    return dlat * dlat + dlng * dlng
}

function pointToSegmentDist2(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number
): number {
    const dx = bx - ax, dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return dist2(px, py, ax, ay)
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
    return dist2(px, py, ax + t * dx, ay + t * dy)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findNearestWay(point: RoutePoint, ways: any[]): any {
    let bestWay = null
    let bestDist = Infinity

    for (const way of ways) {
        const geom: { lat: number; lon: number }[] = way.geometry ?? []
        for (let i = 0; i < geom.length - 1; i++) {
            const d = pointToSegmentDist2(
                point.lat, point.lng,
                geom[i].lat, geom[i].lon,
                geom[i + 1].lat, geom[i + 1].lon
            )
            if (d < bestDist) {
                bestDist = d
                bestWay = way
            }
        }
    }

    // Accept match only if within ~50 m  (0.0005° ≈ 55 m at equator)
    const THRESHOLD = 0.0005 * 0.0005 * 4
    return bestDist < THRESHOLD ? bestWay : null
}

// Query Overpass for all ways with surface tags inside the route's bounding box,
// then stamp each RoutePoint with the surface of the nearest matching way.
export async function enrichRouteWithOSMSurface(points: RoutePoint[]): Promise<void> {
    if (!points.length) return

    const lats = points.map(p => p.lat)
    const lngs = points.map(p => p.lng)
    const south = Math.min(...lats) - 0.001
    const west  = Math.min(...lngs) - 0.001
    const north = Math.max(...lats) + 0.001
    const east  = Math.max(...lngs) + 0.001

    const query = '[out:json][timeout:30];'
        + 'way["highway"]["surface"]'
        + '(' + south + ',' + west + ',' + north + ',' + east + ');'
        + 'out geom;'

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8_000)

    try {
        const resp = await fetch(OSM_OVERPASS_URL, {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (!resp.ok) return

        const json = await resp.json()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ways = (json.elements ?? []).filter((e: any) => e.type === 'way' && e.geometry?.length)
        if (!ways.length) return

        for (const point of points) {
            const nearest = findNearestWay(point, ways)
            if (nearest) {
                point.surface = osmTagToSurface(nearest.tags?.surface)
            }
        }
    } catch {
        // Overpass unavailable, network error, or timeout — silently ignore
    } finally {
        clearTimeout(timeoutId)
    }
}

// ─── Main enrichment entry-point (called from GPXParser.buildInfo) ────────────

export async function enrichSurfaces(
    points: RoutePoint[],
    fileInfo: FileInfo
): Promise<void> {
    if (!points.length) return

    const loader = getBindings().loader

    // Priority 1: companion .surfaces.csv file
    const entries = await tryLoadCompanionSurface(fileInfo, loader)
    if (entries && entries.length > 0) {
        applySurfacesToPoints(points, entries)
        return
    }

    // Priority 2: OSM Overpass (only in auto mode)
    let mode = 'auto'
    try {
        const settings = useUserSettings()
        mode = settings.get('preferences.roadFeel.mode', 'auto') ?? 'auto'
    } catch {
        // Settings not yet initialized (e.g. in tests) – default to auto
    }
    if (mode === 'auto' && process.env.NODE_ENV !== 'test') {
        await enrichRouteWithOSMSurface(points)
    }
    // In 'manual' mode (or if OSM fails), surface stays undefined;
    // RouteDisplayService will emit the configured fallback at ride start.
}
