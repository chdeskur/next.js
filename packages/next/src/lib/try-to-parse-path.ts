import type { Token } from 'next/dist/compiled/path-to-regexp'
import {
  parse,
  tokensToRegexp,
  pathToRegexp,
  compile,
  regexpToFunction,
} from 'next/dist/compiled/path-to-regexp'
import { parse as parseURL } from 'url'
import isError from './is-error'

interface ParseResult {
  error?: any
  parsedPath: string
  regexStr?: string
  route: string
  tokens?: Token[]
}

/**
 * If there is an error show our error link but still show original error or
 * a formatted one if we can
 */
function reportError({ route, parsedPath }: ParseResult, err: any) {
  let errMatches
  if (isError(err) && (errMatches = err.message.match(/at (\d{0,})/))) {
    const position = parseInt(errMatches[1], 10)
    console.error(
      `\nError parsing \`${route}\` ` +
        `https://nextjs.org/docs/messages/invalid-route-source\n` +
        `Reason: ${err.message}\n\n` +
        `  ${parsedPath}\n` +
        `  ${new Array(position).fill(' ').join('')}^\n`
    )
  } else {
    console.error(
      `\nError parsing ${route} https://nextjs.org/docs/messages/invalid-route-source`,
      err
    )
  }
}

/**
 * Fixes tokens that have repeating modifiers (* or +) but empty prefix and suffix.
 * This is needed to work around path-to-regexp 6.3.0+ which doesn't allow such tokens.
 */
function fixTokensForRegexp(tokens: Token[]): Token[] {
  return tokens.map((token) => {
    if (
      typeof token === 'object' &&
      token !== null &&
      'modifier' in token &&
      (token.modifier === '*' || token.modifier === '+') &&
      'prefix' in token &&
      'suffix' in token &&
      token.prefix === '' &&
      token.suffix === ''
    ) {
      // For tokens with repeating modifiers but no prefix/suffix,
      // we need to provide a minimal prefix to satisfy path-to-regexp
      return {
        ...token,
        prefix: '/',
      }
    }
    return token
  })
}

/**
 * Fixes route patterns that have adjacent parameters without text between them.
 * This is needed to work around path-to-regexp 6.3.0+ validation.
 * We use a special marker that can be stripped out later to avoid parameter pollution.
 */
function fixAdjacentParameters(route: string): string {
  let fixed = route

  // Use a special marker that users would never add themselves
  // and that we can strip out before it leaks into params
  const PARAM_SEPARATOR = '__NEXT_SEP__'

  // The issue is (.):param - add our special separator
  fixed = fixed.replace(/(\([^)]*\)):([^/\s]+)/g, `$1${PARAM_SEPARATOR}:$2`)

  // Handle other basic adjacent parameter patterns conservatively
  fixed = fixed.replace(/:([^:/\s)]+)(?=:)/g, `:$1${PARAM_SEPARATOR}`)

  return fixed
}

/**
 * Detects if a route pattern has issues that would cause path-to-regexp 6.3.0+ validation to fail
 */
function hasAdjacentParameterIssues(route: string): boolean {
  if (typeof route !== 'string') return false

  // Check for interception route markers followed immediately by parameters
  // Pattern: (.):param, (..):param, etc.
  if (/\([^)]*\):[^/\s]+/.test(route)) {
    return true
  }

  // Check for adjacent parameters without separators
  // Pattern: :param1:param2
  if (/:([^:/\s)]+):/.test(route)) {
    return true
  }

  return false
}

/**
 * Safe wrapper around pathToRegexp that handles path-to-regexp 6.3.0+ validation errors.
 * This includes both "Can not repeat without prefix/suffix" and "Must have text between parameters" errors.
 */
export function safePathToRegexp(
  route: string | RegExp | Array<string | RegExp>,
  keys?: any[],
  options?: any
): RegExp {
  // Proactively fix known problematic patterns
  if (typeof route === 'string' && hasAdjacentParameterIssues(route)) {
    const fixedRoute = fixAdjacentParameters(route)
    return pathToRegexp(fixedRoute, keys, options)
  }

  try {
    return pathToRegexp(route, keys, options)
  } catch (error) {
    // For any remaining edge cases, try the fix as fallback
    if (isError(error) && typeof route === 'string') {
      try {
        const fixedRoute = fixAdjacentParameters(route)
        return pathToRegexp(fixedRoute, keys, options)
      } catch (retryError) {
        // If that doesn't work, fall back to original error
        throw error
      }
    }
    throw error
  }
}

/**
 * Safe wrapper around compile that handles path-to-regexp 6.3.0+ validation errors.
 */
export function safeCompile(route: string, options?: any) {
  // Proactively fix known problematic patterns
  if (hasAdjacentParameterIssues(route)) {
    const fixedRoute = fixAdjacentParameters(route)
    return compile(fixedRoute, options)
  }

  try {
    return compile(route, options)
  } catch (error) {
    // For any remaining edge cases, try the fix as fallback
    if (isError(error)) {
      try {
        const fixedRoute = fixAdjacentParameters(route)
        return compile(fixedRoute, options)
      } catch (retryError) {
        // If that doesn't work, fall back to original error
        throw error
      }
    }
    throw error
  }
}

/**
 * Safe wrapper around tokensToRegexp that handles path-to-regexp 6.3.0+ validation errors.
 */
function safeTokensToRegexp(tokens: Token[]): RegExp {
  try {
    return tokensToRegexp(tokens)
  } catch (error) {
    if (isError(error)) {
      // Try to fix tokens with repeating modifiers but no prefix/suffix
      const fixedTokens = fixTokensForRegexp(tokens)
      return tokensToRegexp(fixedTokens)
    }
    throw error
  }
}

/**
 * Strips the special parameter separator from extracted route parameters.
 * This is internal to the safe wrappers and should not be used elsewhere.
 */
function stripParameterSeparators(
  params: Record<string, any>
): Record<string, any> {
  const PARAM_SEPARATOR = '__NEXT_SEP__'
  const cleaned: Record<string, any> = {}

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      // Remove the separator if it appears at the start of parameter values
      cleaned[key] = value.replace(new RegExp(`^${PARAM_SEPARATOR}`), '')
    } else {
      cleaned[key] = value
    }
  }

  return cleaned
}

/**
 * Safe wrapper around regexpToFunction that automatically cleans parameters.
 */
export function safeRegexpToFunction<
  T extends Record<string, any> = Record<string, any>,
>(regexp: RegExp, keys?: any[]): (pathname: string) => { params: T } | false {
  const originalMatcher = regexpToFunction<T>(regexp, keys || [])

  return (pathname: string) => {
    const result = originalMatcher(pathname)
    if (!result) return false

    // Clean parameters before returning
    return {
      ...result,
      params: stripParameterSeparators(result.params as any) as T,
    }
  }
}

/**
 * Safe wrapper for route matcher functions that automatically cleans interception markers.
 */
export function safeRouteMatcher<T extends Record<string, any>>(
  matcherFn: (pathname: string) => false | T
): (pathname: string) => false | T {
  return (pathname: string) => {
    const result = matcherFn(pathname)
    if (!result) return false

    // Clean parameters before returning
    return stripParameterSeparators(result) as T
  }
}

/**
 * Attempts to parse a given route with `path-to-regexp` and returns an object
 * with the result. Whenever an error happens on parse, it will print an error
 * attempting to find the error position and showing a link to the docs. When
 * `handleUrl` is set to `true` it will also attempt to parse the route
 * and use the resulting pathname to parse with `path-to-regexp`.
 */
export function tryToParsePath(
  route: string,
  options?: {
    handleUrl?: boolean
  }
): ParseResult {
  const result: ParseResult = { route, parsedPath: route }
  try {
    if (options?.handleUrl) {
      const parsed = parseURL(route, true)
      result.parsedPath = `${parsed.pathname!}${parsed.hash || ''}`
    }

    result.tokens = parse(result.parsedPath)

    // Use safe wrapper instead of proactive detection
    if (result.tokens) {
      result.regexStr = safeTokensToRegexp(result.tokens).source
    }
  } catch (err) {
    reportError(result, err)
    result.error = err
  }

  return result
}
