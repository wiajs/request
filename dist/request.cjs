/*!
  * wia request v3.0.33
  * (c) 2022-2024 Sibyl Yu and contributors
  * Released under the MIT License.
  */
'use strict';

const stream = require('node:stream');
const log$2 = require('@wiajs/log');
const http = require('node:http');
const https = require('node:https');
const assert = require('node:assert');
const url = require('node:url');
const zlib = require('node:zlib');
const mime = require('mime-types');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
class ZlibTransform extends stream.Transform {
  /**
   * 
   * @param {*} chunk 
   * @param {*} encoding 
   * @param {*} callback 
   */
  __transform(chunk, encoding, callback) {
    this.push(chunk);
    callback();
  }

  /**
   * 
   * @param {*} chunk 
   * @param {*} encoding 
   * @param {*} callback 
   */
  _transform(chunk, encoding, callback) {
    if (chunk.length !== 0) {
      this._transform = this.__transform;

      // Add Default Compression headers if no zlib headers are present
      if (chunk[0] !== 120) {
        // Hex: 78
        const header = Buffer.alloc(2);
        header[0] = 120; // Hex: 78
        header[1] = 156; // Hex: 9C
        this.push(header, encoding);
      }
    }

    this.__transform(chunk, encoding, callback);
  }
}

/**
 * utils for request
 */

const {URL: URL$1} = url;

// Whether to use the native URL object or the legacy url module
let useNativeURL = false;
try {
  assert(new URL$1(''));
} catch (error) {
  useNativeURL = error.code === 'ERR_INVALID_URL';
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
];

/**
 * Create a custom error type.
 * @param {string} code - The error code.
 * @param {string} message - The error message.
 * @param {typeof Error} [baseClass] - The base error class to extend from. Defaults to `Error`.
 * @returns {typeof Error & { new(properties?: object): CustomErrorInstance }} A custom error constructor.
 * new(properties?: object) 为构造函数语法，返回 CustomErrorInstance 类型
 * @typedef {object} CustomErrorInstance
 * @property {string} code - The error code.
 * @property {string} message - The error message.
 * @property {Error | undefined} cause - The optional error cause.
 */
function createErrorType(code, message, baseClass) {
  /**
   * Create constructor
   * @param {*} properties
   */
  function CustomError(properties) {
    // istanbul ignore else
    if (isFunction(Error.captureStackTrace)) {
      Error.captureStackTrace(this, this.constructor);
    }
    Object.assign(this, properties || {});
    this.code = code;
    // @ts-ignore
    this.message = this.cause ? `${message}: ${this.cause.message}` : message;
  }

  // Attach constructor and set default properties
  CustomError.prototype = new (baseClass || Error)();
  Object.defineProperties(CustomError.prototype, {
    constructor: {
      value: CustomError,
      enumerable: false,
    },
    name: {
      value: `Error [${code}]`,
      enumerable: false,
    },
  });

  // @ts-ignore
  return CustomError
}

const InvalidUrlError = createErrorType('ERR_INVALID_URL', 'Invalid URL', TypeError);

// @ts-ignore
const typeOfTest = type => thing => typeof thing === type;

/**
 * Determine if a value is a String
 *
 * @param {*} val The value to test
 *
 * @returns {boolean} True if value is a String, otherwise false
 */
const isString = typeOfTest('string');

/**
 * Determine if a value is an Array
 *
 * @param {Object} val The value to test
 *
 * @returns {boolean} True if value is an Array, otherwise false
 */
const {isArray} = Array;

/**
 * Determine if a value is undefined
 *
 * @param {*} val The value to test
 *
 * @returns {boolean} True if the value is undefined, otherwise false
 */
const isUndefined = typeOfTest('undefined');

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
const isFunction = typeOfTest('function');

/**
 * Determine if a value is a Number
 *
 * @param {*} val The value to test
 *
 * @returns {boolean} True if value is a Number, otherwise false
 */
const isNumber = typeOfTest('number');

/**
 * Determine if a value is an Object
 *
 * @param {*} thing The value to test
 *
 * @returns {boolean} True if value is an Object, otherwise false
 */
const isObject = thing => thing !== null && typeof thing === 'object';

/**
 * Determine if a value is a Boolean
 *
 * @param {*} thing The value to test
 * @returns {boolean} True if value is a Boolean, otherwise false
 */
const isBoolean = thing => thing === true || thing === false;

const noop = () => {};

/**
 *
 * @param {*} value
 * @returns
 */
function isURL(value) {
  return URL$1 && value instanceof URL$1
}

/**
 *
 * @param {*} rs
 * @returns
 */
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
  const spread = target || {};
  for (const key of preservedUrlFields) {
    spread[key] = urlObject[key];
  }

  // Fix IPv6 hostname
  if (spread.hostname.startsWith('[')) {
    spread.hostname = spread.hostname.slice(1, -1);
  }
  // Ensure port is a number
  if (spread.port !== '') {
    spread.port = Number(spread.port);
  }
  // Concatenate path
  spread.path = spread.search ? spread.pathname + spread.search : spread.pathname;

  return spread
}

/**
 *
 * @param {*} input
 * @returns
 */
function parseUrl(input) {
  let parsed;
  // istanbul ignore else
  if (useNativeURL) {
    parsed = new URL$1(input);
  } else {
    // Ensure the URL is valid and absolute
    parsed = validateUrl(url.parse(input));
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
  return useNativeURL ? new URL$1(relative, base) : parseUrl(url.resolve(base, relative))
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

/**
 * Determine if a value is a Stream
 *
 * @param {*} val The value to test
 *
 * @returns {boolean} True if value is a Stream, otherwise false
 */
const isStream = val => isObject(val) && isFunction(val.pipe);

const utils = {
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
  isStream,
  noop,
  parseUrl,
  spreadUrlObject,
  validateUrl,
  resolveUrl,
  noBody,
};

class Caseless {
  /**
   * @param {*} dict
   */
  constructor(dict) {
    this.dict = dict || {};
  }

  /**
   *
   * @param {*} name
   * @param {*} value
   * @param {*} clobber
   * @returns
   */
  set(name, value, clobber) {
    if (typeof name === 'object') {
      for (const n of name) {
        this.set(n, name[n], value);
      }
    } else {
      if (typeof clobber === 'undefined') clobber = true;
      const has = this.has(name);

      if (!clobber && has) this.dict[has] = this.dict[has] + ',' + value;
      else this.dict[has || name] = value;
      return has
    }
  }

  /**
   *
   * @param {string} name
   * @returns
   */
  has(name) {
    const keys = Object.keys(this.dict);
    name = name.toLowerCase();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) return keys[i]
    }
    return false
  }

  /**
   *
   * @param {string} name
   * @returns
   */
  get(name) {
    name = name.toLowerCase();
    let result;
    let _key;
    const headers = this.dict;
    for (const key of Object.keys(headers)) {
      _key = key.toLowerCase();
      if (name === _key) result = headers[key];
    }
    return result
  }

  /**
   *
   * @param {string} name
   * @returns
   */
  swap(name) {
    const has = this.has(name);
    if (has === name) return
    if (!has) throw new Error('There is no header than matches "' + name + '"')
    this.dict[name] = this.dict[has];
    delete this.dict[has];
  }

  /**
   * 
   * @param {string} name 
   * @returns 
   */
  del(name) {
    name = String(name).toLowerCase();
    let deleted = false;
    let changed = 0;
    const dict = this.dict;
    for (const key of Object.keys(this.dict)) {
      if (name === String(key).toLowerCase()) {
        deleted = delete dict[key];
        changed += 1;
      }
    }
    return changed === 0 ? true : deleted
  }
}

/**
 * fork from follow-redirects
 * https://github.com/follow-redirects/follow-redirects
 */

const log$1 = log$2.log({env: `wia:req:${log$2.name((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('request.cjs', document.baseURI).href)))}`}); // __filename

/**
 * @typedef {object} Opts
 * @prop {Object.<string,string>} headers
 * @prop {string} host
 * @prop {string} method
 * @prop {string} family
 * @prop {string} path
 * @prop {'http:' | 'https:'} protocol
 * @prop {*} agent
 * @prop {*} agents
 * @prop {boolean} [stream]
 * @prop {boolean} [decompress=true]
 * @prop {*} [transformStream]
 * @prop {*} [beforeRedirect]
 * @prop {boolean} [followRedirects]
 * @prop {number} [maxRedirects=21]
 * @prop {number} [maxBodyLength = -1]
 * @prop {*} [trackRedirects]
 * @prop {*} [data]
 */

/** @typedef {object} ResponseExt
 * @prop {*[]} [redirects]
 * @prop {string} [responseUrl]
 * @prop {number} [responseStartTime]
 */

/** @typedef { http.IncomingMessage & ResponseExt} Response */

const httpModules = {'http:': http, 'https:': https};

const zlibOptions = {
  flush: zlib.constants.Z_SYNC_FLUSH,
  finishFlush: zlib.constants.Z_SYNC_FLUSH,
};

const brotliOptions = {
  flush: zlib.constants.BROTLI_OPERATION_FLUSH,
  finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
};

const isBrotliSupported = utils.isFunction(zlib.createBrotliDecompress);

// clientRequest 属性转发
const writeProps = [
  'protocol',
  'method',
  'path',
  'host',
  'reusedSocket',
  'socket',
  'closed',
  'destroyed',
  'writable',
  'writableAborted',
  'writableEnded',
  'writableCorked',
  'errored',
  'writableFinished',
  'writableHighWaterMark',
  'writableLength',
  'writableNeedDrain',
  'writableObjectMode',
];

// clientReq 方法转发
const writeMethods = ['cork', 'flushHeaders', 'setNoDelay', 'setSocketKeepAlive'];

// Create handlers that pass events from native requests
// 在 clientRequest 事件转发写事件
const writeEvents = [
  // 'abort', // 弃用
  // 'aborted', // 弃用
  'close',
  'connect',
  'continue',
  'drain',
  // 'error', // 单独处理，未注册 'error' 事件处理程序，错误将冒泡到全局导致程序崩溃
  'finish',
  'information',
  'pipe',
  // 'response', 由 processResponse 触发
  'socket', // 建立连接时触发
  'timeout',
  'unpipe',
  'upgrade',
];

const writeEventEmit = Object.create(null);

for (const ev of writeEvents)
  writeEventEmit[ev] = /** @param  {...any} args */ function (...args) {
    const m = this; // 事件回调，this === clientRequest 实例
    // log('req event', {ev})
    m.redirectReq.emit(ev, ...args); // 内部请求req 事情转发到 Request
  };

// stream.Readable，在响应流上转发读流取事件
// data 单独处理
const readEvents = ['close', 'end', 'error', 'pause', 'readable', 'resume'];
const readEventEmit = Object.create(null);
for (const ev of readEvents)
  readEventEmit[ev] = /** @param  {...any} args */ function (...args) {
    const m = this; // 事件回调，this === clientRequest 实例
    // log('res event', {ev})
    m.redirectReq.emit(ev, ...args); // 向上触发事件
  };

// Error types with codes
const RedirectionError = utils.createErrorType(
  'ERR_FR_REDIRECTION_FAILURE',
  'Redirected request failed'
);

const TooManyRedirectsError = utils.createErrorType(
  'ERR_FR_TOO_MANY_REDIRECTS',
  'Maximum number of redirects exceeded',
  RedirectionError
);

const MaxBodyLengthExceededError = utils.createErrorType(
  'ERR_FR_MAX_BODY_LENGTH_EXCEEDED',
  'Request body larger than maxBodyLength limit'
);

const WriteAfterEndError = utils.createErrorType('ERR_STREAM_WRITE_AFTER_END', 'write after end');

// request err
const HostNotfoundError = utils.createErrorType('ERR_HOSTNOTFOUND', 'DNS 解析失败，主机名可能无效');
const ConnRefusedError = utils.createErrorType(
  'ERR_CONNREFUSED',
  '连接被拒绝，目标服务器可能不可用'
);
const ConnTimedoutError = utils.createErrorType(
  'ERR_CONNTIMEDOUT',
  '请求超时，请检查网络连接或服务器负载'
);
const ConnResetError = utils.createErrorType(
  'ERR_CONNRESET',
  '连接被重置，可能是网络问题或服务器关闭了连接'
);

/**
 * An HTTP(S) request that can be redirected
 * wrap http.ClientRequest
 */
class Request extends stream.Duplex {
  /** @type {NodeJS.Timeout} */
  _timeout = null
  /** @type {*} */
  socket = null
  /** @type {http.ClientRequest} */
  _currentRequest = null
  /** @type {Response} */
  response = null
  /** @type {stream.Readable} */
  responseStream = null
  timing = false
  responseStarted = false
  responseStartTime = 0
  _destdata = false
  _paused = false
  _respended = false
  /** @type {stream.Readable} */
  pipesrc = null // 被 pipe 时的 src stream
  /** @type {stream.Writable[]} */
  pipedests = [] // pipe dest
  /** @type {*} */
  startTimer = null
  /** @type {Opts} */
  opt
  /** @type {*} */
  pipefilter
  /** @type {string} */
  _currentUrl

  /**
   * responseCallback 原消息处理回调
   * @param {Opts} opts
   * @param {*} resCallback
   */
  constructor(opts, resCallback) {
    super();
    const m = this;

    // log({opts}, 'new Request')

    // Initialize the request
    m.sanitizeOptions(opts);
    m.opt = opts;
    m.headers = opts.headers;

    // log({opts}, 'constructor')

    m._ended = false;
    m._ending = false;
    m._redirectCount = 0;
    /** @type {any[]} */
    m._redirects = [];
    m._requestBodyLength = 0;
    /** @type {any[]} */
    m._requestBodyBuffers = [];

    // save the callback if passed
    m.resCallback = resCallback;

    /**
     * React to responses of native requests
     * 接管 response 事件，非重定向，触发 response 事件
     * @param {Response} res
     */
    m._onResponse = res => {
      try {
        m.processResponse(res);
      } catch (cause) {
        m.emit(
          'error',
          cause instanceof RedirectionError ? cause : new RedirectionError({cause: cause})
        );
      }
    };

    // Proxy all other public ClientRequest methods 'getHeader'
    for (const method of writeMethods) {
      // @ts-ignore
      m[method] = (a, b) => {
        // log(method, {a, b})
        // @ts-ignore
        m._currentRequest?.[method](a, b);
      };
    }

    // Proxy all public ClientRequest properties
    // 'aborted', 'connection' 弃用
    for (const property of writeProps) {
      Object.defineProperty(m, property, {
        get() {
          // @ts-ignore
          const val = m._currentRequest?.[property];
          // log('get property', {property})
          return val
        },
      });
    }

    // 流模式
    if (opts.stream) {
      // 被 pipe 作为目标时触发，拷贝 src headers
      m.on(
        'pipe',
        /** @param {stream.Readable & {headers?: Object.<string, string>}} src */ src => {
          // m.ntick &&
          if (m._currentRequest) {
            m.emit(
              'error',
              new Error('You cannot pipe to this stream after the outbound request has started.')
            );
          }

          m.pipesrc = src;

          if (utils.isReadStream(src)) {
            // @ts-ignore
            if (!m.hasHeader('content-type')) m.setHeader('content-type', mime.lookup(src.path));
          } else {
            // 拷贝请求头
            if (src.headers) {
              for (const k of Object.keys(src.headers)) {
                if (!m.hasHeader(k)) {
                  m.setHeader(k, src.headers[k]);
                }
              }
            }

            // @ts-ignore
            if (src.opt.method && !m.opt.method) m.opt.method = src.opt.method;
          }
        }
      );
    }

    // Perform the first request
    // m.request(); // 创建时不连接，写入数据时连接，否则 pipe 时无法写入header
  }

  /**
   * Executes the next native request (initial or redirect)
   * @returns http(s) 实例
   */
  request() {
    let R = null;
    const m = this;
    const {opt} = m;

    try {
      // reset read stream
      m.response = null;
      m.responseStarted = false;
      m.responseStream = null;
      m.timing = false;
      m.responseStartTime = 0;
      m._destdata = false;
      m._paused = false;
      m._respended = false;

      // m.httpModule = httpModules[protocol];

      // Load the native protocol
      let {protocol} = opt;
      const {agents} = opt;

      // 代理以目的网址协议为准
      // If specified, use the agent corresponding to the protocol
      // (HTTP and HTTPS use different types of agents)
      // agents 优于 agent
      if (agents) {
        const scheme = protocol.slice(0, -1);
        opt.agent = agents[scheme];

        // http 非隧道代理模式，模块以代理主机为准，其他以目的网址为准
        // 代理内部会根据代理协议选择 http(s) 发起请求创建连接
        if (protocol === 'http:' && agents.http) {
          protocol =
            agents.http.proxy && !agents.http.tunnel ? agents.http.proxy.protocol : protocol;
        }
      }

      const httpModule = httpModules[protocol];
      if (!httpModule) throw TypeError(`Unsupported protocol: ${protocol}`)

      // log({opt, protocol}, 'request')
      // Create the native request and set up its event handlers
      // @ts-ignore
      const req = httpModule.request(opt, m._onResponse);
      m._currentRequest = req;
      // @ts-ignore
      req.redirectReq = m;

      // 启动 startTimer
      if (m.startTimer) m._currentRequest.once('socket', m.startTimer);

      // set tcp keep alive to prevent drop connection by peer
      req.on(
        'socket',
        /** @param {*} socket */ socket => {
          // default interval of sending ack packet is 1 minute
          socket.setKeepAlive(true, 1000 * 60);
        }
      );

      // 请求error单独处理
      // 'error' 事件处理，避免错误将冒泡到全局导致程序崩溃
      req.on('error', err => {
        destroyRequest(req); // 释放资源
        // @ts-ignore
        log$1.error({errcode: err?.code}, 'request');
        // @ts-ignore
        switch (err?.code) {
          case 'ENOTFOUND':
            m.emit('error', new HostNotfoundError());
            break
          case 'ECONNREFUSED':
            m.emit('error', new ConnRefusedError());
            break
          case 'ETIMEDOUT':
            m.emit('error', new ConnTimedoutError());
            break
          case 'ECONNRESET':
            m.emit('error', new ConnResetError());
            break
          default:
            m.emit('error', utils.createErrorType('ERR_CONNOTHER', `网络错误: ${err.message}`));
        }
      });

      // 接收req事件，转发 到 request 上发射，网络关闭事件，触发 error
      for (const ev of writeEvents) req.on(ev, writeEventEmit[ev]);

      // RFC7230§5.3.1: When making a request directly to an origin server, […]
      // a client MUST send only the absolute path […] as the request-target.
      // When making a request to a proxy, […]
      // a client MUST send the target URI in absolute-form […].
      m._currentUrl = /^\//.test(opt.path) ? url.format(opt) : opt.path;

      // End a redirected request
      // (The first request must be ended explicitly with RedirectableRequest#end)
      if (m._isRedirect) {
        // Write the request entity and end
        let i = 0;
        const buffers = m._requestBodyBuffers;

        /**
         *
         * @param {*} error
         */
        function writeNext(error) {
          // Only write if this request has not been redirected yet
          /* istanbul ignore else */
          if (req === m._currentRequest) {
            // Report any write errors
            /* istanbul ignore if */
            if (error) m.emit('error', error);
            // Write the next buffer if there are still left
            else if (i < buffers.length) {
              const buf = buffers[i++];
              /* istanbul ignore else */
              if (!req.finished) req.write(buf.data, buf.encoding, writeNext);
            }
            // End the request if `end` has been called on us
            else if (m._ended) req.end();
          }
        }
        writeNext();
      }

      R = req;
    } catch (e) {
      log$1.err(e, 'request');
      throw e
    }

    return R
  }

  /**
   * 写入错误，释放请求，触发 abort 终止事件
   */
  abort() {
    destroyRequest(this._currentRequest);
    this.emit('abort');
  }

  /**
   * 析构
   * @param {*} error
   * @returns
   */
  destroy(error) {
    const m = this;
    if (!m._ended) m.end();
    if (m.response) m.response.destroy();
    if (m.responseStream) m.responseStream.destroy();

    // m.clearTimeout();
    destroyRequest(m._currentRequest, error);
    super.destroy(error);
    return this
  }

  /**
   * 发送数据
   */
  send() {
    const m = this;
    const {data} = m.opt;
    // 发送数据
    if (utils.isStream(data)) {

      data.on('end', () => {
      });

      data.once(
        'error',
        /** @param {*} err */ err => {
          // req.destroy(err)
        }
      );

      data.on('close', () => {
        // if (!ended && !errored) {
        //   throw new WritebBeenAbortedError()
        // }
      });

      data.pipe(m); // 写入数据流
    } else m.end(data);
  }

  /**
   * Writes buffered data to the current native request
   * 如 request 不存在，则创建连接，pipe 时可写入 header
   * @override -  重写父类方法
   * @param {*} chunk - The data chunk to write.
   * @param {BufferEncoding | ((error: Error | null) => void)} [encoding] - Encoding for string data, or the callback if no encoding is provided.
   * @param {(error: Error | null) => void} [cb] - Callback to signal the end of the write operation.
   * @returns {boolean} True if the write was successful, false otherwise.
   */
  write(chunk, encoding, cb) {
    const m = this;
    // log({data: chunk, encoding, cb}, 'write')

    // Writing is not allowed if end has been called
    if (m._ending) {
      // throw new WriteAfterEndError()
      m.emit('error', new WriteAfterEndError());
      return
    }

    // ! 数据写入时连接，pipe 时可设置 header
    if (!m._currentRequest) m.request();

    // Validate input and shift parameters if necessary
    if (!utils.isString(chunk) && !utils.isBuffer(chunk))
      throw new TypeError('data should be a string, Buffer or Uint8Array')

    if (utils.isFunction(encoding)) {
      // @ts-ignore
      cb = encoding;
      encoding = null;
    }

    // Ignore empty buffers, since writing them doesn't invoke the callback
    // https://github.com/nodejs/node/issues/22066
    if (chunk.length === 0) {
      if (cb) cb(null);
      return
    }

    // Only write when we don't exceed the maximum body length
    if (m._requestBodyLength + chunk.length <= m.opt.maxBodyLength) {
      m._requestBodyLength += chunk.length;
      m._requestBodyBuffers.push({data: chunk, encoding});
      // @ts-ignore
      m._currentRequest.write(chunk, encoding, cb);
    }
    // Error when we exceed the maximum body length
    else {
      m.emit('error', new MaxBodyLengthExceededError());
      m.abort();
    }
  }

  /**
   * Ends the current native request
   * @override -  重写父类方法
   * @param {*} [chunk] - Optional data to write before ending the stream.
   * @param {BufferEncoding | (() => void)} [encoding] - Encoding for string data, or the callback if no encoding is provided.
   * @param {() => void} [cb] - Optional callback to signal completion.
   * @returns {this} The current stream instance, to allow chaining.
   */
  end(chunk, encoding, cb) {
    const m = this;

    // Shift parameters if necessary
    if (utils.isFunction(chunk)) {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (utils.isFunction(encoding)) {
      // @ts-ignore
      cb = encoding;
      encoding = null;
    }

    // ! 创建实例时不连接，数据写入时发起连接，连接后无法设置 header，因此 pipe 时可设置 header
    if (!m._currentRequest) m.request();

    // Write data if needed and end
    if (!chunk) {
      m._ended = true;
      m._ending = true;
      m._currentRequest.end(null, null, cb);
    } else {
      const currentRequest = m._currentRequest;
      m.write(chunk, encoding, () => {
        m._ended = true;
        currentRequest.end(null, null, cb);
      });

      m._ending = true;
    }

    return m
  }

  /**
   *
   * @param {string} name
   * @returns
   */
  hasHeader(name) {
    return Object.keys(this.opt.headers).includes(name)
  }

  /**
   *
   * @param {string} name
   * @returns {string}
   */
  getHeader(name) {
    return this.opt.headers[name]
  }

  /**
   * Sets a header value on the current native request
   * @param {string} name
   * @param {string} value
   */
  setHeader(name, value) {
    this.opt.headers[name] = value;
    this._currentRequest?.setHeader(name, value);
  }

  /**
   * Clears a header value on the current native request
   * @param {string} name
   */
  removeHeader(name) {
    delete this.opt.headers[name];
    this._currentRequest?.removeHeader(name);
  }

  /**
   * 标头是否已发送
   * @returns
   */
  get headersSent() {
    return this._currentRequest?.headersSent
  }

  /**
   * Global timeout for all underlying requests
   * @param {*} msecs
   * @param {*} callback
   * @returns
   */
  setTimeout(msecs, callback) {
    const m = this;

    /**
     * Destroys the socket on timeout
     * @param {*} socket
     */
    function destroyOnTimeout(socket) {
      socket.setTimeout(msecs);
      socket.removeListener('timeout', socket.destroy);
      socket.addListener('timeout', socket.destroy);
    }

    /**
     * Sets up a timer to trigger a timeout event
     * @param {*} socket
     */
    function startTimer(socket) {
      if (m.startTimer) m.startTimer = null;

      if (m._timeout) clearTimeout(m._timeout);

      m._timeout = setTimeout(() => {
        m.emit('timeout');
        clearTimer();
      }, msecs);

      destroyOnTimeout(socket);
    }

    // Stops a timeout from triggering
    function clearTimer() {
      // Clear the timeout
      if (m._timeout) {
        clearTimeout(m._timeout);
        m._timeout = null;
      }

      // Clean up all attached listeners
      m.removeListener('abort', clearTimer);
      m.removeListener('error', clearTimer);
      m.removeListener('response', clearTimer);
      m.removeListener('close', clearTimer);

      if (callback) {
        m.removeListener('timeout', callback);
      }
      if (!m.socket) {
        m._currentRequest.removeListener('socket', startTimer);
      }
    }

    // Attach callback if passed
    if (callback) m.on('timeout', callback);

    // Start the timer if or when the socket is opened
    if (m.socket) startTimer(m.socket);
    else m.startTimer = startTimer; // 未连接，先登记，连接后启动

    // Clean up on events
    m.on('socket', destroyOnTimeout);
    m.on('abort', clearTimer);
    m.on('error', clearTimer);
    m.on('response', clearTimer);
    m.on('close', clearTimer);

    return m
  }

  /**
   *
   * @param {*} options
   */
  sanitizeOptions(options) {
    // Ensure headers are always present
    if (!options.headers) options.headers = {};

    // Since http.request treats host as an alias of hostname,
    // but the url module interprets host as hostname plus port,
    // eliminate the host property to avoid confusion.
    if (options.host) {
      // Use hostname if set, because it has precedence
      if (!options.hostname) {
        options.hostname = options.host;
      }
      options.host = undefined;
    }

    // Complete the URL object when necessary
    if (!options.pathname && options.path) {
      const searchPos = options.path.indexOf('?');
      if (searchPos < 0) {
        options.pathname = options.path;
      } else {
        options.pathname = options.path.substring(0, searchPos);
        options.search = options.path.substring(searchPos);
      }
    }
  }

  /**
   * Processes a response from the current native request
   * @param {Response} response
   * @returns
   */
  processResponse(response) {
    const m = this;
    const {opt} = m;

    // Store the redirected response
    const {statusCode} = response;
    if (opt.trackRedirects) {
      m._redirects.push({
        url: m._currentUrl,
        headers: response.headers,
        statusCode,
      });
    }

    // RFC7231§6.4: The 3xx (Redirection) class of status code indicates
    // that further action needs to be taken by the user agent in order to
    // fulfill the request. If a Location header field is provided,
    // the user agent MAY automatically redirect its request to the URI
    // referenced by the Location field value,
    // even if the specific status code is not understood.

    // If the response is not a redirect; return it as-is
    const {location} = response.headers;

    // log({statusCode, headers: response.headers}, 'processResponse')

    if (!location || opt.followRedirects === false || statusCode < 300 || statusCode >= 400) {
      // 非重定向，返回给原始回调处理
      response.responseUrl = m._currentUrl;
      response.redirects = m._redirects;

      if (opt.stream) m.response = response;

      // Be a good stream and emit end when the response is finished.
      // Hack to emit end on close because of a core bug that never fires end
      response.on('close', () => {
        if (!m._respended) {
          response.emit('end');
        }
      });

      response.once('end', () => {
        m._respended = true;
      });

      const responseStream = m.processStream(response);
      // NOTE: responseStartTime is deprecated in favor of .timings
      response.responseStartTime = m.responseStartTime;

      // 触发原回调函数
      m.resCallback?.(response, responseStream);

      // 类似 ClientRequest，触发 response 事件
      m.emit('response', response, responseStream);

      // Clean up
      m._requestBodyBuffers = [];
      return // 退出，不继续处理
    }

    // The response is a redirect, so abort the current request
    destroyRequest(m._currentRequest);
    // Discard the remainder of the response to avoid waiting for data
    response.destroy();

    // RFC7231§6.4: A client SHOULD detect and intervene
    // in cyclical redirections (i.e., "infinite" redirection loops).
    if (++m._redirectCount > opt.maxRedirects) throw new TooManyRedirectsError()

    // Store the request headers if applicable
    let requestHeaders;
    const {beforeRedirect} = opt;
    if (beforeRedirect) {
      requestHeaders = {
        // The Host header was set by nativeProtocol.request
        // @ts-ignore
        Host: response.req.getHeader('host'),
        ...opt.headers,
      };
    }

    // RFC7231§6.4: Automatic redirection needs to done with
    // care for methods not known to be safe, […]
    // RFC7231§6.4.2–3: For historical reasons, a user agent MAY change
    // the request method from POST to GET for the subsequent request.
    const {method} = opt;
    if (
      ((statusCode === 301 || statusCode === 302) && opt.method === 'POST') ||
      // RFC7231§6.4.4: The 303 (See Other) status code indicates that
      // the server is redirecting the user agent to a different resource […]
      // A user agent can perform a retrieval request targeting that URI
      // (a GET or HEAD request if using HTTP) […]
      (statusCode === 303 && !/^(?:GET|HEAD)$/.test(opt.method))
    ) {
      m.opt.method = 'GET';
      // Drop a possible entity and headers related to it
      m._requestBodyBuffers = [];
      removeMatchingHeaders(/^content-/i, opt.headers);
    }

    // Drop the Host header, as the redirect might lead to a different host
    const currentHostHeader = removeMatchingHeaders(/^host$/i, opt.headers);

    // If the redirect is relative, carry over the host of the last request
    const currentUrlParts = utils.parseUrl(m._currentUrl);
    const currentHost = currentHostHeader || currentUrlParts.host;
    const currentUrl = /^\w+:/.test(location)
      ? m._currentUrl
      : url.format(Object.assign(currentUrlParts, {host: currentHost}));

    // Create the redirected request
    const redirectUrl = utils.resolveUrl(location, currentUrl);

    log$1({redirectUrl}, 'redirecting to');

    m._isRedirect = true;
    // 覆盖原 url 解析部分，包括 protocol、hostname、port等
    utils.spreadUrlObject(redirectUrl, m.opt);

    // Drop confidential headers when redirecting to a less secure protocol
    // or to a different domain that is not a superdomain
    if (
      (redirectUrl.protocol !== currentUrlParts.protocol && redirectUrl.protocol !== 'https:') ||
      (redirectUrl.host !== currentHost && !isSubdomain(redirectUrl.host, currentHost))
    ) {
      removeMatchingHeaders(/^(?:(?:proxy-)?authorization|cookie)$/i, this.opt.headers);
    }

    // Evaluate the beforeRedirect callback
    if (utils.isFunction(beforeRedirect)) {
      const responseDetails = {
        headers: response.headers,
        statusCode,
      };
      const requestDetails = {
        url: currentUrl,
        method,
        headers: requestHeaders,
      };

      beforeRedirect(opt, responseDetails, requestDetails);
      m.sanitizeOptions(opt);
    }

    // Perform the redirected request
    m.request(); // 重新执行请求
  }

  /**
   * 处理响应stream
   * 自动解压，透传流，需设置 decompress = false，避免解压数据
   * @param {Response} res
   * @returns {Response | stream.Readable}
   */
  processStream(res) {
    const m = this;
    const {opt} = m;

    const streams = [res];
    let responseStream = res;
    // 'transfer-encoding': 'chunked'时，无content-length，axios v1.2 不能自动解压
    const responseLength = +res.headers['content-length'];

    // log('processStream', {
    //   statusCode: res.statusCode,
    //   responseLength,
    //   headers: res.headers,
    // })

    if (opt.transformStream) {
      opt.transformStream.responseLength = responseLength;
      streams.push(opt.transformStream);
    }

    const empty = utils.noBody(opt.method, res.statusCode);
    // decompress the response body transparently if required
    if (opt.decompress !== false && res.headers['content-encoding']) {
      // if decompress disabled we should not decompress
      // 压缩内容，加入 解压 stream，自动解压，axios v1.2 存在bug，不能自动解压
      // if no content, but headers still say that it is encoded,
      // remove the header not confuse downstream operations
      // if ((!responseLength || res.statusCode === 204) && res.headers['content-encoding']) {
      if (empty && res.headers['content-encoding']) res.headers['content-encoding'] = undefined;

      // 'content-encoding': 'gzip',
      switch ((res.headers['content-encoding'] || '').toLowerCase()) {
        /*eslint default-case:0*/
        case 'gzip':
        case 'x-gzip':
        case 'compress':
        case 'x-compress':
          // add the unzipper to the body stream processing pipeline
          // @ts-ignore
          streams.push(zlib.createUnzip(zlibOptions));

          // remove the content-encoding in order to not confuse downstream operations
          res.headers['content-encoding'] = undefined;
          break

        case 'deflate':
          // @ts-ignore
          streams.push(new ZlibTransform());

          // add the unzipper to the body stream processing pipeline
          // @ts-ignore
          streams.push(zlib.createUnzip(zlibOptions));

          // remove the content-encoding in order to not confuse downstream operations
          res.headers['content-encoding'] = undefined;
          break

        case 'br':
          if (isBrotliSupported) {
            // @ts-ignore
            streams.push(zlib.createBrotliDecompress(brotliOptions));
            res.headers['content-encoding'] = undefined;
          }
          break
      }
    }

    // 响应流，用于读
    // @ts-ignore
    responseStream = streams.length > 1 ? stream.pipeline(streams, utils.noop) : streams[0];
    // 将内部 responseStream 可读流 映射到 redirectReq

    // @ts-ignore
    m.responseStream = responseStream;
    // @ts-ignore
    responseStream.redirectReq = m; // 事情触发时引用

    // stream 模式，事件透传到 请求类
    if (opt.stream) {
      if (m._paused) responseStream.pause();
      // 写入目的流
      for (const dest of m.pipedests) m.pipeDest(dest);

      // 接收responseStream事件，转发 到 redirectReq 发射
      for (const ev of readEvents) responseStream.on(ev, readEventEmit[ev]);

      // @ts-ignore
      responseStream.on('data', chunk => {
        if (m.timing && !m.responseStarted) {
          m.responseStartTime = new Date().getTime();
        }
        m._destdata = true;
        m.emit('data', chunk); // 向上触发
      });
    }

    // 可读流结束，触发 finished，方便上层清理
    // A cleanup function which removes all registered listeners.
    const offListeners = stream.finished(responseStream, () => {
      offListeners(); // cleanup
      this.emit('finished');
    });

    return responseStream
  }

  // Read Stream API

  /**
   * 建立读取流管道
   * read stream to write stream
   * pipe 只是建立连接管道，后续自动传输数据
   * @override -  重写父类方法
   * @template T - 需要模板
   * @param {T & stream.Writable} dest - The writable stream to which data is written.
   * @param {Object} [opt] - Optional configuration object.
   * @param {boolean} [opt.end=true] - Whether to end the writable stream when the readable stream ends.
   * @returns {T} The destination stream.
   */
  pipe(dest, opts = {}) {
    const m = this;
    // m.pipe()
    // 请求已响应
    if (m.responseStream) {
      // 已有数据，不可pipe
      if (m._destdata)
        m.emit('error', new Error('You cannot pipe after data has been emitted from the response.'));
      else if (m._respended)
        m.emit('error', new Error('You cannot pipe after the response has been ended.'));
      else {
        // stream.Stream.prototype.pipe.call(self, dest, opts);
        super.pipe(dest, opts); // 建立连接管道，自动传输数据
        m.pipeDest(dest);
        return dest // 返回写入 stream
      }
    } else {
      // 已请求还未响应
      m.pipedests.push(dest);
      // stream.Stream.prototype.pipe.call(self, dest, opts);
      super.pipe(dest, opts); // 建立连接管道
      return dest // 返回写入 stream
    }
  }

  /**
   * 分离先前使用pipe()方法附加的Writable流。
   * @param {stream.Writable} dest
   * @returns
   */
  unpipe(dest) {
    const m = this;

    // 请求已响应
    if (m.responseStream) {
      // 已有数据，不可 unpipe
      if (m._destdata)
        m.emit(
          'error',
          new Error('You cannot unpipe after data has been emitted from the response.')
        );
      else if (m._respended)
        m.emit('error', new Error('You cannot unpipe after the response has been ended.'));
      else {
        // stream.Stream.prototype.pipe.call(self, dest, opts);
        super.unpipe(dest); // 建立连接管道，自动传输数据
        m.pipedests = m.pipedests.filter(v => v !== dest);
        return m
      }
    } else {
      // 已请求还未响应
      m.pipedests = m.pipedests.filter(v => v !== dest);
      super.unpipe(dest); // 从连接管道中分离
      return m
    }
  }

  /**
   * 收请求响应，传输数据到可写流之前，设置可写流 header
   * content-type 和 content-length，实现数据 透传，比如图片
   * 流模式透传，需设置 decompress = false，避免解压数据
   * (await req.stream('http://google.com/img.png')).pipe(await req.stream('http://mysite.com/img.png'))
   * pipe to dest
   * @param {*} dest
   */
  pipeDest(dest) {
    const m = this;
    const {response} = m;

    // Called after the response is received
    if (response?.headers && dest.headers && !dest.headersSent) {
      const caseless = new Caseless(response.headers);
      if (caseless.has('content-type')) {
        const ctname = /** @type {string} */ (caseless.has('content-type'));
        if (dest.setHeader) {
          dest.setHeader(ctname, response.headers[ctname]);
        } else {
          dest.headers[ctname] = response.headers[ctname];
        }
      }

      if (caseless.has('content-length')) {
        const clname = /** @type {string} */ (caseless.has('content-length'));
        if (dest.setHeader) {
          dest.setHeader(clname, response.headers[clname]);
        } else {
          dest.headers[clname] = response.headers[clname];
        }
      }
    }

    if (response?.headers && dest.setHeader && !dest.headersSent) {
      for (const k of Object.keys(response.headers)) dest.setHeader(k, response.headers[k]);

      dest.statusCode = response.statusCode;
    }

    if (m.pipefilter) m.pipefilter(response, dest);
  }

  /**
   * 暂停read流
   */
  pause() {
    const m = this;
    // 没有流
    if (!m.responseStream) m._paused = true;
    else m.responseStream.pause();
    return m
  }

  /**
   * 继续read响应流
   */
  resume() {
    const m = this;
    if (!m.responseStream) m._paused = false;
    else m.responseStream.resume();
    return m
  }

  isPaused() {
    return this._paused
  }
}

/**
 * 释放请求，触发error事件
 *  'error' event, and emit a 'close' event.
 * Calling this will cause remaining data in the response to be dropped and the socket to be destroyed.
 * @param {*} request
 * @param {*} error
 */
function destroyRequest(request, error) {
  for (const ev of writeEvents) {
    request.removeListener(ev, writeEventEmit[ev]);
  }
  request.on('error', utils.noop);
  request.destroy(error); // 触发 error 事件
}

/**
 *
 * @param {RegExp} regex
 * @param {Object.<string, string>} headers
 * @returns
 */
function removeMatchingHeaders(regex, headers) {
  let lastValue;
  for (const k of Object.keys(headers)) {
    if (regex.test(k)) {
      lastValue = headers[k];
      delete headers[k];
    }
  }

  return lastValue === null || typeof lastValue === 'undefined'
    ? undefined
    : String(lastValue).trim()
}

/**
 *
 * @param {string} subdomain
 * @param {string} domain
 * @returns
 */
function isSubdomain(subdomain, domain) {
  assert(utils.isString(subdomain) && utils.isString(domain));
  const dot = subdomain.length - domain.length - 1;
  return dot > 0 && subdomain[dot] === '.' && subdomain.endsWith(domain)
}

/**
 * from 'https://github.com/follow-redirects/follow-redirects'
 * used by axios
 * 修改以支持http、https 代理服务器
 * 代理模式下，http or https 请求，取决于 proxy 代理服务器，而不是目的服务器。
 */

const log = log$2.log({env: `wia:req:${log$2.name((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('request.cjs', document.baseURI).href)))}`}); // __filename

/** @typedef { import('./request').Response} Response */

/**
 * @typedef {object} Opts
 * @prop {Object.<string,string>} [headers]
 * @prop {string} [url]
 * @prop {'http:' | 'https:'} [protocol]
 * @prop {string} [host]
 * @prop {string} [hostname]
 * @prop {string} [family]
 * @prop {string} [path]
 * @prop {string} [method]
 * @prop {*} [agent] - 发送请求的agent
 * @prop {*} [agents] - http、https agent，根据协议自动选择
 * @prop {*} [body] - body 数据，优先body，其次data
 * @prop {*} [data] - body 数据
 * @prop {boolean} [stream] -  以流的方式工作
 * @prop {boolean} [decompress=true] - 自动解压
 * @prop {*} [transformStream]
 * @prop {*} [beforeRedirect]
 * @prop {boolean} [followRedirects] - 自动完成重定向
 * @prop {number} [maxRedirects=21] - 最大重定向次数
 * @prop {number} [maxBodyLength = 0] - body限制，缺省不限
 * @prop {*} [trackRedirects]
 */

/** @typedef {(res: Response, stream?: stream.Readable) => void} Cb*/

utils.createErrorType(
  'ERR_STREAM_WRITE_BEEN_ABORTED',
  'Request stream has been aborted'
)

// Preventive platform detection
// istanbul ignore
;(function detectUnsupportedEnvironment() {
  const looksLikeNode = typeof process !== 'undefined';
  const looksLikeBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const looksLikeV8 = utils.isFunction(Error.captureStackTrace);
  if (!looksLikeNode && (looksLikeBrowser || !looksLikeV8)) {
    log.warn('The follow-redirects package should be excluded from browser builds.');
  }
})();

/**
 * 封装http(s)，实现重定向
 * 重定向可能切换http、https
 * 支持隧道及非隧道、http(s)代理
 */

/**
 * 初始化参数
 * @param {string | Opts} uri/opts
 * @param {Opts | Cb} [opts] /cb
 * @param {Cb} [cb]
 * @returns {{opt: Opts, cb: Cb}}
 */
function init(uri, opts, cb) {
  let R;
  try {
    // Parse parameters, ensuring that input is an object
    if (utils.isURL(uri)) uri = utils.spreadUrlObject(uri);
    else if (utils.isString(uri)) uri = utils.spreadUrlObject(utils.parseUrl(uri));
    else {
      // @ts-ignore
      cb = opts;
      // @ts-ignore
      opts = uri;
      // @ts-ignore
      const {url} = opts;
      // 有url，解析
      if (url) {
        // @ts-ignore
        // biome-ignore lint/performance/noDelete: <explanation>
        delete opts.url;
        if (utils.isURL(url)) uri = utils.spreadUrlObject(url);
        else if (utils.isString(url)) uri = utils.spreadUrlObject(utils.parseUrl(url));
      } else {
        // @ts-ignore
        opts = uri; // 不判断 utils.validateUrl(uri)
        uri = {};
      }
    }

    if (utils.isFunction(opts)) {
      // @ts-ignore
      cb = opts;
      opts = {};
    }

    // copy options
    /** @type {Opts} */
    const opt = {
      // @ts-ignore
      ...uri,
      ...opts,
    };

    if (!utils.isString(opt.host) && !utils.isString(opt.hostname)) opt.hostname = '::1';
    opt.method = (opt.method ?? 'get').toUpperCase();

    // follow-redirects does not skip comparison, so it should always succeed for axios -1 unlimited
    opt.maxBodyLength = opt.maxBodyLength ?? Number.POSITIVE_INFINITY;
    opt.maxRedirects = opt.maxRedirects ?? 21;
    if (opt.maxRedirects === 0) opt.followRedirects = false;
    opt.headers = opt.headers ?? {
      Accept: 'application/json, text/plain, */*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.35',
      'Accept-Encoding': 'gzip, compress, deflate, br',
    };

    R = {opt, cb};
    // log({R}, 'init')
  } catch (e) {
    log.err(e, 'init');
  }

  // @ts-ignore
  return R
}

/**
 * Executes a request, following redirects
 * 替换原 http(s).request，参数类似
 * 需外部调用 end() data.pipe 或stream管道写入数据
 * 注意变参 (options[, callback]) or (url[, options][, callback])
    maxRedirects: _.maxRedirects,
    maxBodyLength: _.maxBodyLength,
 * @param {string | Opts} uri /options
 * @param {Opts | Cb} [opts] /callback
 * @param {Cb} [callback] /null
 * @returns {Request}
 */
function request(uri, opts, callback) {
  let R = null;

  try {
    // @ts-ignore
    const {opt, cb} = init(uri, opts, callback);
    // log.error({uri, options, opts}, 'request')

    const {data, stream} = opt;
    // data 在本函数完成处理，不传递到 request
    opt.data = undefined;

    // @ts-ignore
    const req = new Request(opt, cb);

    // 非流模式，自动发送请求，流模式通过流写入发送
    if (!stream) {
      // 发送数据
      if (utils.isStream(data)) {
        // Send the request
        let ended = false;
        let errored = false;

        data.on('end', () => {
          ended = true;
        });

        data.once(
          'error',
          /** @param {*} err */ err => {
            errored = true;
            // req.destroy(err)
          }
        );

        data.on('close', () => {
          if (!ended && !errored) {
            // throw new WritebBeenAbortedError()
          }
        });

        // log.error({data}, 'request data.pipe')
        data.pipe(req); // 写入数据流
      } else {
        // log.error({data}, 'request req.end')
        req.end(data); // 写入数据
      }
    }

    R = req;
  } catch (e) {
    log.err(e, 'request');
  }

  return R
}

/**
 * 执行简单的数据（支持stream）请求
 * 非流模式，直接写入数据流，流模式，由管道触发，或手动调用 end() data.pipe 写入数据
 * 复杂数据，请使用 @wiajs/req库（fork from axios），该库封装了当前库，提供了更多功能
 * organize params for patch, post, put, head, del
 * @param {string} verb
 * @returns {(url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void}}
 */
function fn(verb) {
  const method = verb.toUpperCase();
  /**
   *
   * @param {string | Opts} uri /options
   * @param {Opts | Cb} [opts] /callback
   * @param {Cb} [cb] /null
   * @returns
   */
  function fn(uri, opts, cb) {
    // @ts-ignore
    opts.method = method;
    return request(uri, opts, cb)
  }
  return fn
}

// define like this to please codeintel/intellisense IDEs
request.get = fn('get');
request.head = fn('head');
request.options = fn('options');
request.post = fn('post');
request.put = fn('put');
request.patch = fn('patch');
request.del = fn('delete');
request.delete = fn('delete');

module.exports = request;
