import { EventEmitter } from 'events'
import { DiagnosticEvent, TestRideOptions, TestRideState, TestSummary } from './types'

let _instance: TestRideService | undefined

export class TestRideService extends EventEmitter {

    private running: boolean = false
    private timer: ReturnType<typeof setInterval> | null = null
    private routeDistance: number = 0
    private speed: number = 5.36  // m/s (~12 mph)
    private currentSurface?: string
    private events: DiagnosticEvent[] = []
    private startTime: number = 0
    private route: any = null
    private options: TestRideOptions | null = null
    private sendUpdateFn: ((request: any) => void) | null = null
    private originalSetRoadFeel: ((...args: any[]) => Promise<boolean>) | null = null
    private adapter: any = null
    private displayService: any = null
    private lastTickTime: number = 0

    start(
        route: any,
        adapter: any,
        sendUpdateFn: (request: any) => void,
        displayService: any,
        options: TestRideOptions
    ): void {
        if (this.running) {
            this.log('Already running, ignoring start()')
            return
        }

        this.route = route
        this.adapter = adapter
        this.sendUpdateFn = sendUpdateFn
        this.displayService = displayService
        this.options = options
        this.events = []
        this.routeDistance = 0
        this.currentSurface = undefined
        this.running = true
        this.startTime = Date.now()
        this.lastTickTime = this.startTime

        // Set trainer slope
        if (sendUpdateFn) {
            sendUpdateFn({ slope: options.slope })
        }

        // Wrap adapter.setRoadFeel for logging
        if (adapter && typeof adapter.setRoadFeel === 'function') {
            this.originalSetRoadFeel = adapter.setRoadFeel.bind(adapter)
            adapter.setRoadFeel = this.wrappedSetRoadFeel.bind(this)
        }

        this.addEvent({
            type: 'info',
            message: `Test ride started — slope=${options.slope}%, mode=${options.mode}, intensity=${options.intensity}`
        })

        // Start 500ms position timer
        this.timer = setInterval(() => this.tick(), 500)

        this.log('Started')
    }

    stop(): void {
        if (!this.running) return

        // Clear timer
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }

        // Reset slope to 0
        if (this.sendUpdateFn) {
            this.sendUpdateFn({ slope: 0 })
        }

        // Unwrap setRoadFeel
        if (this.adapter && this.originalSetRoadFeel) {
            this.adapter.setRoadFeel = this.originalSetRoadFeel
            this.originalSetRoadFeel = null
        }

        this.running = false

        const summary = this.computeSummary()

        this.addEvent({
            type: 'info',
            message: `Test ride stopped — ${summary.transitions} transitions, BLE OK=${summary.bleOk} FAIL=${summary.bleFail}, pass=${summary.pass}`
        })

        this.log(`Stopped — duration=${summary.duration}ms, distance=${summary.distance.toFixed(1)}m, pass=${summary.pass}`)

        console.log('[RoadFeel Test] Summary:', JSON.stringify(summary, null, 2))

        this.emit('complete', summary)
    }

    onSurfaceChange(surface: string): void {
        const prevSurface = this.currentSurface

        if (surface === prevSurface) return

        this.currentSurface = surface

        this.addEvent({
            type: 'surface-change',
            surface,
            prevSurface,
            message: `Surface: ${prevSurface ?? 'none'} → ${surface}`
        })
    }

    getState(): TestRideState {
        return {
            running: this.running,
            routeDistance: this.routeDistance,
            speed: this.speed,
            currentSurface: this.currentSurface,
            events: [...this.events],
            summary: this.running ? null : this.computeSummary()
        }
    }

    isRunning(): boolean {
        return this.running
    }

    private tick(): void {
        const now = Date.now()
        const dt = (now - this.lastTickTime) / 1000  // seconds
        this.lastTickTime = now

        this.routeDistance += this.speed * dt

        if (this.displayService && typeof this.displayService.injectPosition === 'function') {
            this.displayService.injectPosition(this.routeDistance)
        }

        this.emit('update', this.getState())
    }

    private async wrappedSetRoadFeel(...args: any[]): Promise<boolean> {
        const surface = args[0] as number
        const intensity = args[1] as number

        try {
            const result = await this.originalSetRoadFeel!(...args)

            this.addEvent({
                type: 'road-feel-sent',
                roadFeelParams: { surface, intensity },
                bleResult: result,
                message: `setRoadFeel(surface=${surface}, intensity=${intensity}) → ${result ? 'OK' : 'FAIL'}`
            })

            return result
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)

            this.addEvent({
                type: 'error',
                roadFeelParams: { surface, intensity },
                bleResult: false,
                message: `setRoadFeel error: ${message}`
            })

            return false
        }
    }

    private addEvent(partial: Omit<DiagnosticEvent, 'timestamp' | 'distance'>): void {
        const event: DiagnosticEvent = {
            ...partial,
            timestamp: Date.now(),
            distance: this.routeDistance
        }

        this.events.push(event)

        const elapsed = ((event.timestamp - this.startTime) / 1000).toFixed(1)
        const distKm = (event.distance / 1000).toFixed(3)
        this.log(`[${elapsed}s] ${distKm}km ${event.message ?? event.type}`)

        this.emit('event', event)
    }

    private computeSummary(): TestSummary {
        const bleOk = this.events.filter(e => e.type === 'road-feel-sent' && e.bleResult === true).length
        const bleFail = this.events.filter(e => e.type === 'road-feel-sent' && e.bleResult === false).length
        const transitions = this.events.filter(e => e.type === 'surface-change').length

        return {
            duration: Date.now() - this.startTime,
            distance: this.routeDistance,
            transitions,
            bleOk,
            bleFail,
            pass: bleFail === 0 && transitions > 0
        }
    }

    private log(message: string): void {
        console.log(`[RoadFeel Test] ${message}`)
    }
}

export const useTestRideService = (): TestRideService => {
    if (!_instance) {
        _instance = new TestRideService()
    }
    return _instance
}
