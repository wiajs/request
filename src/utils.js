/**
 * utils for request
 */
import url from 'node:url'
import assert from 'node:assert'

const {URL} = url

// Whether to use the native URL object or the legacy url module
let useNativeURL = false
try {
  assert(new URL(''))
} catch (error) {
  useNativeURL = error.code === 'ERR_INVALID_URL'
}

// URL fields to preserve in copy operations
const preservedUrlFields = [
  'auth',
  'host',
  'hostname',
  'href',
  'path',
  'pathname',
  'port',
  'protocol',
  'query',
  'search',
  'hash',
]

/**
 *
 * @param {*} code
 * @param {*} message
 * @param {*} baseClass
 * @returns
 */
function createErrorType(code, message, baseClass) {
  // Create constructor
  function CustomError(properties) {
    // istanbul ignore else
    if (isFunction(Error.captureStackTrace)) {
      Error.captureStackTrace(this, this.constructor)
    }
    Object.assign(this, properties || {})
    this.code = code
    this.message = this.cause ? `${message}: ${this.cause.message}` : message
  }

  // Attach constructor and set default properties
  CustomError.prototype = new (baseClass || Error)()
  Object.defineProperties(CustomError.prototype, {
    constructor: {
      value: CustomError,
      enumerable: false,
    },
    name: {
      value: `Error [${code}]`,
      enumerable: false,
    },
  })
  return CustomError
}

const InvalidUrlError = createErrorType('ERR_INVALID_URL', 'Invalid URL', TypeError)

// @ts-ignore
const typeOfTest = type => thing => typeof thing === type

/**
 * Determine if a value is a String
 *
 * @param {*} val The value to test
 *
 * @returns {boolean} True if value is a String, otherwise false
 */
const isString = typeOfTest('string')

/**
 * Determine if a value is an Array
 *
 * @param {Object} val The value to test
 *
 * @returns {boolean} True if value is an Array, otherwise false
 */
const {isArray} = Array

/**
 * Determine if a value is undefined
 *
 * @param {*} val The value to test
 *
 * @returns {boolean} True if the value is undefined, otherwise false
 */
const isUndefined = typeOfTest('undefined')

/**
 * Determine if a value is a Buffer
 *
 * @param {*} val The value to test
 *
 * @returns {boolean} True if value is a Buffer, otherwise false
 */
function isBuffer(val) {
  return (
    val !== null &&
    !isUndefined(val) &&
    val.constructor !== null &&
    !isUndefined(val.constructor) &&
    isFunction(val.constructor.isBuffer) &&
    val.constructor.isBuffer(val)
  )
}

/**
 * Determine if a value is a Function
 *
 * @param {*} val The value to test
 * @returns {boolean} True if value is a Function, otherwise false
 */
const isFunction = typeOfTest('function')

/**
 * Determine if a value is a Number
 *
 * @param {*} val The value to test
 *
 * @returns {boolean} True if value is a Number, otherwise false
 */
const isNumber = typeOfTest('number')

/**
 * Determine if a value is an Object
 *
 * @param {*} thing The value to test
 *
 * @returns {boolean} True if value is an Object, otherwise false
 */
const isObject = thing => thing !== null && typeof thing === 'object'

/**
 * Determine if a value is a Boolean
 *
 * @param {*} thing The value to test
 * @returns {boolean} True if value is a Boolean, otherwise false
 */
const isBoolean = thing => thing === true || thing === false

const noop = () => {}

/**
 *
 * @param {*} value
 * @returns
 */
function isURL(value) {
  return URL && value instanceof URL
}

function isReadStream(rs) {
  return rs.readable && rs.path && rs.mode
}

/**
 *
 * @param {*} urlObject
 * @param {*} target
 * @returns
 */
function spreadUrlObject(urlObject, target) {
  const spread = target || {}
  for (const key of preservedUrlFields) {
    spread[key] = urlObject[key]
  }

  // Fix IPv6 hostname
  if (spread.hostname.startsWith('[')) {
    spread.hostname = spread.hostname.slice(1, -1)
  }
  // Ensure port is a number
  if (spread.port !== '') {
    spread.port = Number(spread.port)
  }
  // Concatenate path
  spread.path = spread.search ? spread.pathname + spread.search : spread.pathname

  return spread
}

/**
 *
 * @param {*} input
 * @returns
 */
function parseUrl(input) {
  let parsed
  // istanbul ignore else
  if (useNativeURL) {
    parsed = new URL(input)
  } else {
    // Ensure the URL is valid and absolute
    parsed = validateUrl(url.parse(input))
    if (!isString(parsed.protocol)) {
      throw new InvalidUrlError({input})
    }
  }
  return parsed
}

/**
 *
 * @param {*} input
 * @returns
 */
function validateUrl(input) {
  if (/^\[/.test(input.hostname) && !/^\[[:0-9a-f]+\]$/i.test(input.hostname)) {
    throw new InvalidUrlError({input: input.href || input})
  }
  if (/^\[/.test(input.host) && !/^\[[:0-9a-f]+\](:\d+)?$/i.test(input.host)) {
    throw new InvalidUrlError({input: input.href || input})
  }
  return input
}

/**
 *
 * @param {*} relative
 * @param {*} base
 * @returns
 */
function resolveUrl(relative, base) {
  // istanbul ignore next
  return useNativeURL ? new URL(relative, base) : parseUrl(url.resolve(base, relative))
}

/**
 *
 * @param {string} method
 * @param {number} code
 * @returns
 */
function noBody(method, code) {
  return (
    method === 'HEAD' ||
    // Informational
    (code >= 100 && code < 200) ||
    // No Content
    code === 204 ||
    // Not Modified
    code === 304
  )
}

export default {
  createErrorType,
  InvalidUrlError,
  isString,
  isArray,
  isBuffer,
  isUndefined,
  isNumber,
  isBoolean,
  isFunction,
  isObject,
  isURL,
  isReadStream,
  noop,
  parseUrl,
  spreadUrlObject,
  validateUrl,
  resolveUrl,
  noBody,
}
