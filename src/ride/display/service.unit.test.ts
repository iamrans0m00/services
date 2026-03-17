
import { Device } from 'tcx-builder'
import { Inject } from '../../base/decorators'
import { Workout } from '../../workouts'
import { RideDisplayService } from './service'
import { Observer } from '../../base/types'
import { RideType } from '../base'
import sydney from '../../../__tests__/data/routes/sydney.json'
import { Route } from '../../routes/base/model/route'
import { createFromJson } from '../../routes'
import { RouteApiDetail } from '../../routes/base/api/types'
import { waitNextTick } from '../../utils'

const OC = expect.objectContaining
describe('RideDisplayService', () => {

    describe('powerUp', () => {

        let service: RideDisplayService
        let activityValues = {}
        let limits = {}
        let devicePowerUp = jest.fn()


        const simulateData = (s, data: Device) => {
            s.onDeviceData(data, '123')
        }

        const setupMocks = (s, props?: { workout: Workout, activityObserver: Observer }) => {
            let unselected = false
            Inject('ActivityRide', {
                getActivity: jest.fn().mockReturnValue({}),
                init: jest.fn().mockReturnValue(props?.activityObserver ?? new Observer()),
                getCurrentValues: jest.fn().mockReturnValue(activityValues)
            })
            Inject('WorkoutList', {
                getSelected: jest.fn().mockReturnValue(props?.workout),
                getStartSettings: jest.fn().mockReturnValue({ ftp: 200, useErgMode: true })
            })
            Inject('RouteList', {
                getSelected: jest.fn().mockReturnValue(null),
                getStartSettings: jest.fn().mockReturnValue({})
            })
            Inject('DeviceRide', {
                sendUpdate: jest.fn(),
                getControlAdapter: jest.fn(),
                getCyclingMode: jest.fn()
            })
            Inject('UIBinding', {
                enableScreensaver: jest.fn(),
                disableScreensaver: jest.fn(),
            })

            s.startDevices = jest.fn(() => {
                s.onStartCompleted()
                props?.activityObserver.emit('started')
            })
            s.devicePowerUp = devicePowerUp

        }

        const cleanupMocks = (s) => {
            s.reset()
            jest.resetAllMocks()
            Inject('ActivityRide',null)
            Inject('WorkoutList',null)
            Inject('RouteList',null)
            Inject('DeviceRide',null)
            Inject('UIBinding',null)
        }

        beforeEach(() => {
            Inject('UserSettings', {
                get: jest.fn().mockReturnValue(process.env.DEBUG)
            })

            service = new RideDisplayService()
        })

        afterEach(() => {
            if (service)
                cleanupMocks(service)
        })

        test('arrow-up after workout was stopped by user', () => {
            const workout = new Workout({ type: 'workout', name: 'Test Workout' })
            workout.addSegment({
                type: 'segment', text: 'Test Segment', repeat: 10, steps: [
                    { type: 'step', steady: true, work: true, duration: 120, power: { min: 100, max: 100, type: 'pct of FTP' }, text: 'Test Work' },
                    { type: 'step', steady: true, work: false, duration: 60, power: { min: 50, max: 50, type: 'pct of FTP' }, text: 'Test Relax' }
                ]
            })

            const a = new Observer()
            setupMocks(service, { workout, activityObserver: a })

            service.init()
            service.start()
            service.stopWorkout()

            service.onArrowKey({ key: 'ArrowUp' })
            expect(devicePowerUp).toHaveBeenCalled()



        })
    })

    describe('toggleAllOverlays', () => {

        let service: RideDisplayService
        const emit = jest.fn()


        const setupMocks = (s:any, props?: { hidden?: boolean, sideViews?: object, rideType?:RideType, route?:Route, startSettings?:any, setFn? }) => {

            Inject('UserSettings', {
                get: jest.fn((k, d) => {
                    try {
                        const parts = k.split('.');
                        const overlay = parts[parts.length-1];
                        return props?.sideViews?.[overlay]??d
                    }
                    catch { return d}
                }),
                set: props?.setFn??jest.fn()
            })

            Inject('RouteList', {
                getStartSettings: jest.fn().mockReturnValue(props?.startSettings??{}),
                unselect: jest.fn(),
                getSelected: jest.fn().mockReturnValue(props?.route)
            })

            s.observer = new Observer()
            s.observer.emit = emit

            if (props?.rideType)
                s.getRideType = jest.fn().mockReturnValue(props?.rideType)

            s.hideAll = props?.hidden??false
            s.isVirtualShiftingEnabled = jest.fn().mockReturnValue(false)

        }

        const cleanupMocks = (s) => {
            jest.resetAllMocks()
            Inject('UserSettings', null)
            Inject('RouteList',null)
        }

        beforeEach(() => {
            service = new RideDisplayService()
        })

        afterEach(() => {
            service.reset()
            cleanupMocks(service)
            jest.resetAllMocks()
        })

        describe('GPX Route', () => {
            test('all overlays shown', async () => {
                const sideViews = {
                    map: true,
                    'sv-left': true,
                    'sv-right': true,
                    'slope': true,
                    'elevation': true,
                }
                const route = createFromJson( sydney as unknown as RouteApiDetail)
                const setFn = jest.fn()
                setupMocks(service, { hidden: false, sideViews, rideType:'GPX',route,setFn })

                service.toggleAllOverlays()
                await waitNextTick()


                expect(emit).toHaveBeenCalledWith('overlay-update', OC( {
                    hideAll: true,
                    map:OC({show: false}),
                    sideViews: OC({enabled:true, hide:true, left:true, right:true}),
                    upcomingElevation: OC({show:false}),
                    totalElevation: OC({show:false}),
                }))
                expect(setFn).not.toHaveBeenCalled()
                jest.clearAllMocks()

                service.toggleAllOverlays()
                await waitNextTick()

                expect(emit).toHaveBeenCalledWith('overlay-update', OC( {
                    hideAll: false,
                    map: {show:true, minimized:false},
                    sideViews: OC({enabled:true, hide:false, left:true, right:true}),
                    upcomingElevation: {show:true, minimized:false},
                    totalElevation: {show:true, minimized:false},
                }))
                expect(setFn).not.toHaveBeenCalled()


            })
            test('', () => { })
            test('', () => { })
            test('', () => { })

        })

    })

    describe('Natural Shifting', () => {

        let service: RideDisplayService
        let sendUpdate: jest.Mock

        const createMockMode = (props: { isSIM?: boolean; isERG?: boolean; virtshift?: string; name?: string }) => ({
            isSIM: jest.fn().mockReturnValue(props.isSIM ?? true),
            isERG: jest.fn().mockReturnValue(props.isERG ?? false),
            isResistance: jest.fn().mockReturnValue(false),
            getSetting: jest.fn((key) => {
                if (key === 'virtshift') return props.virtshift ?? 'Disabled'
                return undefined
            }),
            getName: jest.fn().mockReturnValue(props.name ?? 'Smart Trainer'),
        })

        const setupMocks = (s: any, mode: any, userSettingsOverrides?: any) => {
            sendUpdate = jest.fn()
            const adapter = { udid: 'test-udid' }

            Inject('DeviceRide', {
                sendUpdate: jest.fn(),
                getControlAdapter: jest.fn().mockReturnValue(adapter),
                getCyclingMode: jest.fn().mockReturnValue(mode),
            })

            // Mock useUserSettings singleton's getValue
            const { useUserSettings } = require('../../settings')
            const us = useUserSettings()
            us.getValue = jest.fn((key, def) => {
                if (key === 'preferences.drivetrainConfig') return userSettingsOverrides?.drivetrainConfig ?? def
                return def
            })

            s.getRideModeService = jest.fn().mockReturnValue({ sendUpdate })
        }

        const cleanupMocks = (s: any) => {
            s.reset()
            jest.resetAllMocks()
            Inject('DeviceRide', null)
            Inject('UserSettings', null)
        }

        beforeEach(() => {
            Inject('UserSettings', null)
            service = new RideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        describe('devicePowerUp', () => {

            test('Natural mode clamps gearDelta to +1 for inc=5', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode)

                ;(service as any).devicePowerUp(5)

                expect(sendUpdate).toHaveBeenCalledWith({ gearDelta: 1 })
            })

            test('Natural mode clamps gearDelta to -1 for inc=-5', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode)

                ;(service as any).devicePowerUp(-5)

                expect(sendUpdate).toHaveBeenCalledWith({ gearDelta: -1 })
            })

            test('Natural mode sends gearDelta=1 for inc=1', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode)

                ;(service as any).devicePowerUp(1)

                expect(sendUpdate).toHaveBeenCalledWith({ gearDelta: 1 })
            })

            test('non-Natural SIM mode sends gearDelta based on inc/5 formula', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Mixed' })
                setupMocks(service, mode)

                ;(service as any).devicePowerUp(5)

                expect(sendUpdate).toHaveBeenCalledWith({ gearDelta: 1 })
            })

            test('non-Natural SIM mode sends gearDelta=5 for large inc', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Mixed' })
                setupMocks(service, mode)

                ;(service as any).devicePowerUp(25)

                expect(sendUpdate).toHaveBeenCalledWith({ gearDelta: 5 })
            })
        })

        describe('deviceFrontShift', () => {

            test('sends frontDelta in SIM mode', () => {
                const mode = createMockMode({ isSIM: true })
                setupMocks(service, mode)

                ;(service as any).deviceFrontShift(1)

                expect(sendUpdate).toHaveBeenCalledWith({ frontDelta: 1 })
            })

            test('sends negative frontDelta for downshift', () => {
                const mode = createMockMode({ isSIM: true })
                setupMocks(service, mode)

                ;(service as any).deviceFrontShift(-1)

                expect(sendUpdate).toHaveBeenCalledWith({ frontDelta: -1 })
            })

            test('does not send in non-SIM mode', () => {
                const mode = createMockMode({ isSIM: false })
                setupMocks(service, mode)

                ;(service as any).deviceFrontShift(1)

                expect(sendUpdate).not.toHaveBeenCalled()
            })
        })

        describe('getShiftingInfo', () => {

            test('returns isNatural=true for Natural mode', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode, { drivetrainConfig: { type: '1x' } })

                const info = service.getShiftingInfo()

                expect(info.isNatural).toBe(true)
            })

            test('returns hasFrontShift=false for 1x drivetrain', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode, { drivetrainConfig: { type: '1x' } })

                const info = service.getShiftingInfo()

                expect(info.hasFrontShift).toBe(false)
            })

            test('returns hasFrontShift=true for 2x drivetrain', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode, { drivetrainConfig: { type: '2x' } })

                const info = service.getShiftingInfo()

                expect(info.hasFrontShift).toBe(true)
            })

            test('returns hasFrontShift=true for 3x drivetrain', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode, { drivetrainConfig: { type: '3x' } })

                const info = service.getShiftingInfo()

                expect(info.hasFrontShift).toBe(true)
            })

            test('returns isNatural=false for non-Natural mode', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Mixed' })
                setupMocks(service, mode)

                const info = service.getShiftingInfo()

                expect(info.isNatural).toBe(false)
                expect(info.hasFrontShift).toBe(false)
            })

            test('returns isNatural=false for non-SIM mode', () => {
                const mode = createMockMode({ isSIM: false, virtshift: 'Natural' })
                setupMocks(service, mode)

                const info = service.getShiftingInfo()

                expect(info.isNatural).toBe(false)
            })
        })

        describe('onArrowKey front shifting', () => {

            test('Shift+ArrowLeft calls adjustFrontGear(false)', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode)

                const spy = jest.spyOn(service, 'adjustFrontGear')
                service.onArrowKey({ key: 'ArrowLeft', shiftKey: true })

                expect(spy).toHaveBeenCalledWith(false)
            })

            test('Shift+ArrowRight calls adjustFrontGear(true)', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode)

                const spy = jest.spyOn(service, 'adjustFrontGear')
                service.onArrowKey({ key: 'ArrowRight', shiftKey: true })

                expect(spy).toHaveBeenCalledWith(true)
            })

            test('ArrowLeft without shift does not call adjustFrontGear', () => {
                const mode = createMockMode({ isSIM: true, virtshift: 'Natural' })
                setupMocks(service, mode)

                const spy = jest.spyOn(service, 'adjustFrontGear')
                service.onArrowKey({ key: 'ArrowLeft', shiftKey: false })

                expect(spy).not.toHaveBeenCalled()
            })
        })
    })

})