// Node 25+ exposes localStorage on globalThis but throws SecurityError
// unless --localstorage-file is passed. Jest's NodeEnvironment iterates
// globalThis properties and triggers the getter, crashing every test suite.
// This wrapper stubs localStorage before the parent constructor runs.

const storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  get length() { return 0 }
}

try { globalThis.localStorage } catch {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    value: storage
  })
}

try { globalThis.sessionStorage } catch {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    enumerable: true,
    value: storage
  })
}

const { TestEnvironment } = require('jest-environment-node')
module.exports = TestEnvironment
