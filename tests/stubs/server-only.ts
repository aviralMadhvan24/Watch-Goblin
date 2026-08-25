/**
 * Test stand-in for the `server-only` package.
 *
 * The real module throws unless it is resolved under the `react-server`
 * condition, which Vitest does not apply — so every service and query module
 * would fail at import time. Aliased in both vitest configs. It is a marker
 * package with no runtime behaviour, so an empty module is a faithful stub.
 */
export {};
