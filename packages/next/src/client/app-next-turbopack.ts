// TODO-APP: hydration warning

import { renderAppDevOverlay } from 'next/dist/compiled/next-devtools'
import { appBootstrap } from './app-bootstrap'
import {
  getComponentStack,
  getOwnerStack,
} from './components/errors/stitched-error'
import { isRecoverableError } from './react-client-callbacks/on-recoverable-error'

window.next.version += '-turbo'
;(self as any).__webpack_hash__ = ''

const instrumentationHooks = require('../lib/require-instrumentation-client')

appBootstrap(() => {
  const { hydrate } = require('./app-index')
  try {
    hydrate(instrumentationHooks)
  } finally {
    renderAppDevOverlay(getComponentStack, getOwnerStack, isRecoverableError)
  }
})
