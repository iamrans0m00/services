export interface DiagnosticEvent {
    timestamp: number
    type: 'surface-change' | 'road-feel-sent' | 'error' | 'info'
    distance: number
    surface?: string
    prevSurface?: string
    roadFeelParams?: { surface: number; intensity: number }
    bleResult?: boolean
    message?: string
}

export interface TestRideOptions {
    slope: number           // -10 to 0 (percent grade)
    mode: 'auto' | 'manual' | 'off'
    surface?: string        // RoadFeelSurface name, used when mode='manual'
    intensity: number       // 0-100
}

export interface TestRideState {
    running: boolean
    routeDistance: number
    speed: number
    currentSurface?: string
    events: DiagnosticEvent[]
    summary: TestSummary | null
}

export interface TestSummary {
    duration: number        // ms
    distance: number        // metres
    transitions: number
    bleOk: number
    bleFail: number
    pass: boolean
}
