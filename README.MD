# incyclist-services

This Library contains the business logic used by the React components of the [Incyclist](https://incyclist.com) Indoor Cycling App. 

Incyclist uses React to render the App Front-End for PC platforms ( Windows, Mac. Linux). It is planned that in the future, React Native will be used to render the Front-Ends for other platforms ( Android, IOS, AppleTV,...)

All Services will be accessed by the Front-End using 

```
import {useXXX, initXXX} from {incyclist-devices}

```

- useXXX  can be used to consume a Service (e.g. `useDeviceConfiguration()` ) 
- initXXX can be used to perform a lazy initialization of the Service (e.g. `initUserSettings(binding)` ) 

where XXX represents the Service name

The following Services are currently implemented in this library:

## Settings
- [UserSettings](./doc/classes/UserSettingsService.md): manages the user settings 


## Devices
- [DeviceConfiguration](./doc/classes/DeviceConfigurationService.md): manages the user configuration of scanned/added/selected devices
- [DeviceAccess](./doc/classes/DeviceAccessService.md): manages the basic communication to the device (setting up interfacs, scanning,... )
- [Device](./src/devices/device/README.MD): allows the Front-End to communicate with a device (reading, writing data)
- [DevicePairing](./doc/classes/DevicePairingService.md): implements the business logic og the DevicePairing screens

---

## Fork additions (iamrans0m00/services)

### Road Feel – surface-change event

`RouteDisplayService` (`src/ride/route/RouteDisplayService.ts`) emits a `'surface-change'` event
whenever the route surface changes at the current position, and once at ride start with the initial surface.

`RideDisplayService` (`src/ride/display/service.ts`) forwards this event through its `Observer` so
React components can subscribe without reaching into internal services:

```typescript
const observer = useRideDisplay().getObserver()
observer.on('surface-change', (surfaceName?: string) => {
    // surfaceName is a RoadFeelSurface key, e.g. 'Road', 'Gravel', 'Ice'
})
```

The `useRoadFeel()` hook in `incyclist-web-ui` uses this to drive Tacx Neo road feel commands.
