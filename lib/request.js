/**
 * fork from follow-redirects
 * https://github.com/follow-redirects/follow-redirects
 */ import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert';
import url from 'node:url';
import stream from 'node:stream';
import { Duplex } from 'node:stream'; // Writable 流改为读写双工
import zlib from 'node:zlib';
import mime from 'mime-types';
import { log as Log, name } from '@wiajs/log';
import ZlibTransform from './ZlibTransform.js';
import utils from './utils.js';
import Caseless from './caseless.js';
const log = Log({
    env: `wia:req:${name(import.meta.url)}`
}) // __filename
;
const httpModules = {
    'http:': http,
    'https:': https
};
const zlibOptions = {
    flush: zlib.constants.Z_SYNC_FLUSH,
    finishFlush: zlib.constants.Z_SYNC_FLUSH
};
const brotliOptions = {
    flush: zlib.constants.BROTLI_OPERATION_FLUSH,
    finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH
};
const isBrotliSupported = utils.isFunction(zlib.createBrotliDecompress);
// Create handlers that pass events from native requests
const writeEvents = [
    'abort',
    'aborted',
    'close',
    'connect',
    'continue',
    'drain',
    'error',
    'finish',
    'information',
    'pipe',
    // 'response', 由 processResponse 触发
    'socket',
    'timeout',
    'unpipe',
    'upgrade'
];
const writeEventEmit = Object.create(null);
for (const ev of writeEvents)writeEventEmit[ev] = function(...args) {
    const m = this // 事件回调，this === clientRequest 实例
    ;
    log('req event', {
        ev
    });
    m.redirectReq.emit(ev, ...args) // req 事情映射到 redirectReq 上触发
    ;
};
// stream.Readable
// data 单独处理
const readEvents = [
    'close',
    'end',
    'error',
    'pause',
    'readable',
    'resume'
];
const readEventEmit = Object.create(null);
for (const ev of readEvents)readEventEmit[ev] = function(...args) {
    const m = this // 事件回调，this === clientRequest 实例
    ;
    log('res event', {
        ev
    });
    m.redirectReq.emit(ev, ...args) // 向上触发事件
    ;
};
// Error types with codes
const RedirectionError = utils.createErrorType('ERR_FR_REDIRECTION_FAILURE', 'Redirected request failed');
const TooManyRedirectsError = utils.createErrorType('ERR_FR_TOO_MANY_REDIRECTS', 'Maximum number of redirects exceeded', RedirectionError);
const MaxBodyLengthExceededError = utils.createErrorType('ERR_FR_MAX_BODY_LENGTH_EXCEEDED', 'Request body larger than maxBodyLength limit');
const WriteAfterEndError = utils.createErrorType('ERR_STREAM_WRITE_AFTER_END', 'write after end');
/**
 * An HTTP(S) request that can be redirected
 * wrap http.ClientRequest
 */ export default class Request extends Duplex {
    /**
   * responseCallback 原消息处理回调
   * @param {*} opts
   * @param {*} resCallback
   */ constructor(opts, resCallback){
        super(), this._timeout = 0, /** @type {*} */ this.socket = null, /** @type {http.ClientRequest} */ this._currentRequest = null, /** @type {stream.Readable} */ this.response = null, /** @type {stream.Readable} */ this.responseStream = null, this.timing = false, this.responseStarted = false, this.responseStartTime = 0, this._destdata = false, this._paused = false, this._respended = false, /** @type {stream.Readable} */ this.pipesrc = null // 被 pipe 时的 src stream
        , /** @type {stream.Writable[]} */ this.pipedests = [] // pipe dest
        , /** @type {*} */ this.startTimer = null;
        const m = this;
        // log({options}, 'constructor');
        // Initialize the request
        m.sanitizeOptions(opts);
        m.opt = opts;
        m.headers = opts.headers;
        // log({opts}, 'constructor')
        m._ended = false;
        m._ending = false;
        m._redirectCount = 0;
        /** @type {any[]} */ m._redirects = [];
        m._requestBodyLength = 0;
        /** @type {any[]} */ m._requestBodyBuffers = [];
        // save the callback if passed
        m.resCallback = resCallback;
        // React to responses of native requests
        // 接管 response 事件，非重定向，触发 response 事件
        m._onResponse = (res)=>{
            try {
                m.processResponse(res);
            } catch (cause) {
                m.emit('error', cause instanceof RedirectionError ? cause : new RedirectionError({
                    cause: cause
                }));
            }
        };
        // 流模式
        if (opts.stream) {
            // 被 pipe 作为目标时触发，拷贝 src headers
            m.on('pipe', /** @type {stream.Readable} */ (src)=>{
                // m.ntick &&
                if (m._currentRequest) {
                    m.emit('error', new Error('You cannot pipe to this stream after the outbound request has started.'));
                }
                m.pipesrc = src;
                if (utils.isReadStream(src)) {
                    if (!m.hasHeader('content-type')) {
                        m.setHeader('content-type', mime.lookup(src.path));
                    }
                } else {
                    if (src.headers) {
                        for (const h of src.headers){
                            if (!m.hasHeader(h)) {
                                m.setHeader(h, src.headers[h]);
                            }
                        }
                    }
                    if (src.opt.method && !m.opt.method) m.opt.method = src.opt.method;
                }
            });
        }
    // Perform the first request
    // m.request(); // 写入数据时执行，否则 pipe时无法写入header
    }
    /**
   * Executes the next native request (initial or redirect)
   * @returns http(s) 实例
   */ request() {
        let R = null;
        const m = this;
        const { opt } = m;
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
            let { protocol } = opt;
            const { agents } = opt;
            // 代理以目的网址协议为准
            // If specified, use the agent corresponding to the protocol
            // (HTTP and HTTPS use different types of agents)
            if (agents) {
                const scheme = protocol.slice(0, -1);
                opt.agent = agents[scheme];
                // http 非隧道代理模式，模块以代理主机为准，其他以目的网址为准
                // 代理内部会根据代理协议选择 http(s) 发起请求创建连接
                if (protocol === 'http:' && agents.http) {
                    protocol = agents.http.proxy && !agents.http.tunnel ? agents.http.proxy.protocol : protocol;
                }
            }
            const httpModule = httpModules[protocol];
            if (!httpModule) throw TypeError(`Unsupported protocol: ${protocol}`);
            log({
                opt,
                protocol
            }, 'request');
            // Create the native request and set up its event handlers
            const req = httpModule.request(opt, m._onResponse);
            m._currentRequest = req;
            req.redirectReq = m;
            // Proxy all other public ClientRequest methods
            for (const method of [
                'flushHeaders',
                'setNoDelay',
                'setSocketKeepAlive'
            ]){
                m[method] = (a, b)=>{
                    log.debug(method, {
                        a,
                        b
                    });
                    m._currentRequest[method](a, b);
                };
            }
            // Proxy all public ClientRequest properties
            for (const property of [
                'aborted',
                'connection',
                'socket'
            ]){
                Object.defineProperty(m, property, {
                    get () {
                        const val = m._currentRequest[property];
                        log.debug('get property', {
                            property
                        });
                        return val;
                    }
                });
            }
            m._currentRequest.once('socket', m.startTimer);
            // 接收req事件，转发 到 redirectReq 发射
            for (const ev of writeEvents)req.on(ev, writeEventEmit[ev]);
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
                (function writeNext(error) {
                    // Only write if this request has not been redirected yet
                    /* istanbul ignore else */ if (req === m._currentRequest) {
                        // Report any write errors
                        /* istanbul ignore if */ if (error) m.emit('error', error);
                        else if (i < buffers.length) {
                            const buf = buffers[i++];
                            /* istanbul ignore else */ if (!req.finished) req.write(buf.data, buf.encoding, writeNext);
                        } else if (m._ended) req.end();
                    }
                })();
            }
            R = req;
        } catch (e) {
            log.err(e, 'request');
            throw e;
        }
        return R;
    }
    abort() {
        destroyRequest(this._currentRequest);
        this._currentRequest.abort();
        this.emit('abort');
    }
    /**
   * 析构
   * @param {*} error
   * @returns
   */ destroy(error) {
        const m = this;
        if (!m._ended) m.end();
        else if (m.response) m.response.destroy();
        else if (m.responseStream) m.responseStream.destroy();
        // m.clearTimeout();
        destroyRequest(m._currentRequest, error);
        super.destroy(error);
        return this;
    }
    /**
   * Writes buffered data to the current native request
   * 如 request 不存在，则创建连接，pipe 时可写入 header
   * @param {*} chunk
   * @param {BufferEncoding=} encoding
   * @param {(error: Error) => void} [cb]
   * @returns {boolean}
   */ write(chunk, encoding, cb) {
        const m = this;
        log.debug('write', {
            data: chunk,
            encoding,
            callback: cb
        });
        // Writing is not allowed if end has been called
        if (m._ending) throw new WriteAfterEndError();
        // ! 数据写入时连接，pipe 时可设置 header
        if (!m._currentRequest) m.request();
        // Validate input and shift parameters if necessary
        if (!utils.isString(chunk) && !utils.isBuffer(chunk)) throw new TypeError('data should be a string, Buffer or Uint8Array');
        if (utils.isFunction(encoding)) {
            cb = encoding;
            encoding = null;
        }
        // Ignore empty buffers, since writing them doesn't invoke the callback
        // https://github.com/nodejs/node/issues/22066
        if (chunk.length === 0) {
            if (cb) cb();
            return;
        }
        // Only write when we don't exceed the maximum body length
        if (m._requestBodyLength + chunk.length <= m.opt.maxBodyLength) {
            m._requestBodyLength += chunk.length;
            m._requestBodyBuffers.push({
                data: chunk,
                encoding
            });
            m._currentRequest.write(chunk, encoding, cb);
        } else {
            m.emit('error', new MaxBodyLengthExceededError());
            m.abort();
        }
    }
    /**
   * Ends the current native request
   * @param {*} data
   * @param {*} encoding
   * @param {*} callback
   */ end(data, encoding, callback) {
        const m = this;
        // Shift parameters if necessary
        if (utils.isFunction(data)) {
            callback = data;
            data = null;
            encoding = null;
        } else if (utils.isFunction(encoding)) {
            callback = encoding;
            encoding = null;
        }
        // ! 数据写入时连接，pipe 时可设置 header
        if (!m._currentRequest) m.request();
        // Write data if needed and end
        if (!data) {
            m._ended = true;
            m._ending = true;
            m._currentRequest.end(null, null, callback);
        } else {
            const currentRequest = m._currentRequest;
            m.write(data, encoding, ()=>{
                m._ended = true;
                currentRequest.end(null, null, callback);
            });
            m._ending = true;
        }
    }
    /**
   *
   * @param {string} name
   * @returns
   */ hasHeader(name) {
        return this.opt.headers.includes(name);
    }
    /**
   *
   * @param {string} name
   * @returns {string}
   */ getHeader(name) {
        return this.opt.headers[name];
    }
    /**
   * Sets a header value on the current native request
   * @param {string} name
   */ setHeader(name, value) {
        this.opt.headers[name] = value;
        this._currentRequest?.setHeader(name, value);
    }
    /**
   * Clears a header value on the current native request
   * @param {string} name
   */ removeHeader(name) {
        delete this.opt.headers[name];
        this._currentRequest?.removeHeader(name);
    }
    /**
   * 标头是否已发送
   * @returns
   */ get headersSent() {
        return this._currentRequest?.headersSent;
    }
    /**
   * Global timeout for all underlying requests
   * @param {*} msecs
   * @param {*} callback
   * @returns
   */ setTimeout(msecs, callback) {
        const m = this;
        /**
     * Destroys the socket on timeout
     * @param {*} socket
     */ function destroyOnTimeout(socket) {
            socket.setTimeout(msecs);
            socket.removeListener('timeout', socket.destroy);
            socket.addListener('timeout', socket.destroy);
        }
        /**
     * Sets up a timer to trigger a timeout event
     * @param {*} socket
     */ function startTimer(socket) {
            if (m._timeout) clearTimeout(m._timeout);
            m._timeout = setTimeout(()=>{
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
        else m.startTimer = startTimer // 未连接，先登记
        ;
        // Clean up on events
        m.on('socket', destroyOnTimeout);
        m.on('abort', clearTimer);
        m.on('error', clearTimer);
        m.on('response', clearTimer);
        m.on('close', clearTimer);
        return m;
    }
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
   * @param {*} response
   * @returns
   */ processResponse(response) {
        const m = this;
        // Store the redirected response
        const { statusCode } = response;
        if (m.opt.trackRedirects) {
            m._redirects.push({
                url: m._currentUrl,
                headers: response.headers,
                statusCode
            });
        }
        // RFC7231§6.4: The 3xx (Redirection) class of status code indicates
        // that further action needs to be taken by the user agent in order to
        // fulfill the request. If a Location header field is provided,
        // the user agent MAY automatically redirect its request to the URI
        // referenced by the Location field value,
        // even if the specific status code is not understood.
        // If the response is not a redirect; return it as-is
        const { location } = response.headers;
        log('processResponse', {
            statusCode,
            headers: response.headers
        });
        if (!location || m.opt.followRedirects === false || statusCode < 300 || statusCode >= 400) {
            // 非重定向，返回给原始回调处理
            response.responseUrl = m._currentUrl;
            response.redirects = m._redirects;
            m.response = response;
            // Be a good stream and emit end when the response is finished.
            // Hack to emit end on close because of a core bug that never fires end
            response.on('close', ()=>{
                if (!m._respended) {
                    m.response.emit('end');
                }
            });
            response.once('end', ()=>{
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
            return;
        }
        // The response is a redirect, so abort the current request
        destroyRequest(m._currentRequest);
        // Discard the remainder of the response to avoid waiting for data
        response.destroy();
        // RFC7231§6.4: A client SHOULD detect and intervene
        // in cyclical redirections (i.e., "infinite" redirection loops).
        if (++m._redirectCount > m.opt.maxRedirects) throw new TooManyRedirectsError();
        // Store the request headers if applicable
        let requestHeaders;
        const { beforeRedirect } = m.opt;
        if (beforeRedirect) {
            requestHeaders = {
                // The Host header was set by nativeProtocol.request
                Host: response.req.getHeader('host'),
                ...m.opt.headers
            };
        }
        // RFC7231§6.4: Automatic redirection needs to done with
        // care for methods not known to be safe, […]
        // RFC7231§6.4.2–3: For historical reasons, a user agent MAY change
        // the request method from POST to GET for the subsequent request.
        const { method } = m.opt;
        if ((statusCode === 301 || statusCode === 302) && m.opt.method === 'POST' || // RFC7231§6.4.4: The 303 (See Other) status code indicates that
        // the server is redirecting the user agent to a different resource […]
        // A user agent can perform a retrieval request targeting that URI
        // (a GET or HEAD request if using HTTP) […]
        statusCode === 303 && !/^(?:GET|HEAD)$/.test(m.opt.method)) {
            m.opt.method = 'GET';
            // Drop a possible entity and headers related to it
            m._requestBodyBuffers = [];
            removeMatchingHeaders(/^content-/i, m.opt.headers);
        }
        // Drop the Host header, as the redirect might lead to a different host
        const currentHostHeader = removeMatchingHeaders(/^host$/i, m.opt.headers);
        // If the redirect is relative, carry over the host of the last request
        const currentUrlParts = utils.parseUrl(m._currentUrl);
        const currentHost = currentHostHeader || currentUrlParts.host;
        const currentUrl = /^\w+:/.test(location) ? m._currentUrl : url.format(Object.assign(currentUrlParts, {
            host: currentHost
        }));
        // Create the redirected request
        const redirectUrl = utils.resolveUrl(location, currentUrl);
        log({
            redirectUrl
        }, 'redirecting to');
        m._isRedirect = true;
        // 覆盖原 url 解析部分，包括 protocol、hostname、port等
        utils.spreadUrlObject(redirectUrl, m.opt);
        // Drop confidential headers when redirecting to a less secure protocol
        // or to a different domain that is not a superdomain
        if (redirectUrl.protocol !== currentUrlParts.protocol && redirectUrl.protocol !== 'https:' || redirectUrl.host !== currentHost && !isSubdomain(redirectUrl.host, currentHost)) {
            removeMatchingHeaders(/^(?:(?:proxy-)?authorization|cookie)$/i, this.opt.headers);
        }
        // Evaluate the beforeRedirect callback
        if (utils.isFunction(beforeRedirect)) {
            const responseDetails = {
                headers: response.headers,
                statusCode
            };
            const requestDetails = {
                url: currentUrl,
                method,
                headers: requestHeaders
            };
            beforeRedirect(m.opt, responseDetails, requestDetails);
            m.sanitizeOptions(m.opt);
        }
        // Perform the redirected request
        m.request() // 重新执行请求
        ;
    }
    /**
   * 处理响应stream
   * 如：解压，透传流，需设置 decompress = false，避免解压数据
   * @param {*} res
   */ processStream(res) {
        const m = this;
        const { opt: opts } = m;
        const streams = [
            res
        ];
        // 'transfer-encoding': 'chunked'时，无content-length，axios v1.2 不能自动解压
        const responseLength = +res.headers['content-length'];
        log('processStream', {
            statusCode: res.statusCode,
            responseLength,
            headers: res.headers
        });
        if (opts.transformStream) {
            opts.transformStream.responseLength = responseLength;
            streams.push(opts.transformStream);
        }
        const empty = utils.noBody(opts.method, res.statusCode);
        // decompress the response body transparently if required
        if (opts.decompress !== false && res.headers['content-encoding']) {
            // if decompress disabled we should not decompress
            // 压缩内容，加入 解压 stream，自动解压，axios v1.2 存在bug，不能自动解压
            // if no content, but headers still say that it is encoded,
            // remove the header not confuse downstream operations
            // if ((!responseLength || res.statusCode === 204) && res.headers['content-encoding']) {
            if (empty && res.headers['content-encoding']) res.headers['content-encoding'] = undefined;
            // 'content-encoding': 'gzip',
            switch((res.headers['content-encoding'] || '').toLowerCase()){
                /*eslint default-case:0*/ case 'gzip':
                case 'x-gzip':
                case 'compress':
                case 'x-compress':
                    // add the unzipper to the body stream processing pipeline
                    streams.push(zlib.createUnzip(zlibOptions));
                    // remove the content-encoding in order to not confuse downstream operations
                    res.headers['content-encoding'] = undefined;
                    break;
                case 'deflate':
                    streams.push(new ZlibTransform());
                    // add the unzipper to the body stream processing pipeline
                    streams.push(zlib.createUnzip(zlibOptions));
                    // remove the content-encoding in order to not confuse downstream operations
                    res.headers['content-encoding'] = undefined;
                    break;
                case 'br':
                    if (isBrotliSupported) {
                        streams.push(zlib.createBrotliDecompress(brotliOptions));
                        res.headers['content-encoding'] = undefined;
                    }
                    break;
                default:
            }
        }
        const responseStream = streams.length > 1 ? stream.pipeline(streams, utils.noop) : streams[0];
        // 将内部 responseStream 可读流 映射到 redirectReq
        m.responseStream = responseStream;
        responseStream.redirectReq = m // 事情触发时引用
        ;
        // stream 模式，事件透传到 请求类
        if (opts.stream) {
            if (m._paused) responseStream.pause();
            // 写入目的流
            for (const dest of m.pipedests)m.pipeDest(dest);
            // 接收responseStream事件，转发 到 redirectReq 发射
            for (const ev of readEvents)responseStream.on(ev, readEventEmit[ev]);
            // @ts-ignore
            responseStream.on('data', (chunk)=>{
                if (m.timing && !m.responseStarted) {
                    m.responseStartTime = new Date().getTime();
                }
                m._destdata = true;
                m.emit('data', chunk) // 向上触发
                ;
            });
        }
        // 可读流结束，触发 finished，方便上层清理
        // A cleanup function which removes all registered listeners.
        const offListeners = stream.finished(responseStream, ()=>{
            offListeners() // cleanup
            ;
            this.emit('finished');
        });
        return responseStream;
    }
    // Read Stream API
    /**
   * read stream to write stream
   * pipe 只是建立连接管道，后续自动传输数据
   * @param {stream.Writable} dest
   * @param {*} opts
   * @returns {stream.Writable}
   */ pipe(dest, opts) {
        const m = this;
        // 请求已响应
        if (m.responseStream) {
            // 已有数据，不可pipe
            if (m._destdata) m.emit('error', new Error('You cannot pipe after data has been emitted from the response.'));
            else if (m._respended) m.emit('error', new Error('You cannot pipe after the response has been ended.'));
            else {
                // stream.Stream.prototype.pipe.call(self, dest, opts);
                super.pipe(dest, opts) // 建立连接管道，自动传输数据
                ;
                m.pipeDest(dest);
                return dest // 返回写入 stream
                ;
            }
        } else {
            // 已请求还未响应
            m.pipedests.push(dest);
            // stream.Stream.prototype.pipe.call(self, dest, opts);
            super.pipe(dest, opts) // 建立连接管道
            ;
            return dest // 返回写入 stream
            ;
        }
    }
    /**
   * 分离先前使用pipe()方法附加的Writable流。
   * @param {stream.Writable} dest
   * @returns
   */ unpipe(dest) {
        const m = this;
        // 请求已响应
        if (m.responseStream) {
            // 已有数据，不可 unpipe
            if (m._destdata) m.emit('error', new Error('You cannot unpipe after data has been emitted from the response.'));
            else if (m._respended) m.emit('error', new Error('You cannot unpipe after the response has been ended.'));
            else {
                // stream.Stream.prototype.pipe.call(self, dest, opts);
                super.unpipe(dest) // 建立连接管道，自动传输数据
                ;
                m.pipedests = m.pipedests.filter((v)=>v !== dest);
                return m;
            }
        } else {
            // 已请求还未响应
            m.pipedests = m.pipedests.filter((v)=>v !== dest);
            super.unpipe(dest) // 从连接管道中分离
            ;
            return m;
        }
    }
    /**
   * 收请求响应，传输数据到可写流之前，设置可写流 header
   * content-type 和 content-length，实现数据 透传，比如图片
   * 流模式透传，需设置 decompress = false，避免解压数据
   * (await req.stream('http://google.com/img.png')).pipe(await req.stream('http://mysite.com/img.png'))
   * pipe to dest
   * @param {*} dest
   */ pipeDest(dest) {
        const m = this;
        const { response } = m;
        // Called after the response is received
        if (response?.headers && dest.headers && !dest.headersSent) {
            const caseless = new Caseless(response.headers);
            if (caseless.has('content-type')) {
                const ctname = caseless.has('content-type');
                if (dest.setHeader) {
                    dest.setHeader(ctname, response.headers[ctname]);
                } else {
                    dest.headers[ctname] = response.headers[ctname];
                }
            }
            if (caseless.has('content-length')) {
                const clname = caseless.has('content-length');
                if (dest.setHeader) {
                    dest.setHeader(clname, response.headers[clname]);
                } else {
                    dest.headers[clname] = response.headers[clname];
                }
            }
        }
        if (response?.headers && dest.setHeader && !dest.headersSent) {
            for (const h of response.headers){
                dest.setHeader(h, response.headers[h]);
            }
            dest.statusCode = response.statusCode;
        }
        if (m.pipefilter) {
            m.pipefilter(response, dest);
        }
    }
    /**
   * 暂停read流
   * @param  {...any} args
   */ pause(...args) {
        const m = this;
        // 没有流
        if (!m.responseStream) m._paused = true;
        else m.responseStream.pause(...args);
        return m;
    }
    /**
   * 继续read流
   * @param  {...any} args
   */ resume(...args) {
        const m = this;
        if (!m.responseStream) m._paused = false;
        else m.responseStream.resume(...args);
        return m;
    }
    isPaused() {
        return this._paused;
    }
}
/**
 *
 * @param {*} request
 * @param {*} error
 */ function destroyRequest(request, error) {
    for (const ev of writeEvents){
        request.removeListener(ev, writeEventEmit[ev]);
    }
    request.on('error', utils.noop);
    request.destroy(error);
}
function removeMatchingHeaders(regex, headers) {
    let lastValue;
    Object.keys(headers).forEach((k)=>{
        if (regex.test(k)) {
            lastValue = headers[k];
            delete headers[k];
        }
    });
    return lastValue === null || typeof lastValue === 'undefined' ? undefined : String(lastValue).trim();
}
function isSubdomain(subdomain, domain) {
    assert(utils.isString(subdomain) && utils.isString(domain));
    const dot = subdomain.length - domain.length - 1;
    return dot > 0 && subdomain[dot] === '.' && subdomain.endsWith(domain);
}
