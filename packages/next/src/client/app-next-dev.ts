// TODO-APP: hydration warning

import './app-webpack'

import { appBootstrap } from './app-bootstrap'
import { initializeDevBuildIndicatorForAppRouter } from './dev/dev-build-indicator/initialize-for-app-router'

// eslint-disable-next-line @next/internal/typechecked-require
const instrumentationHooks = require('../lib/require-instrumentation-client')

appBootstrap(() => {
  const { hydrate } = require('./app-index') as typeof import('./app-index')
  hydrate(instrumentationHooks)
  initializeDevBuildIndicatorForAppRouter()
})
