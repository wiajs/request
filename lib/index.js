/**
 * from 'https://github.com/follow-redirects/follow-redirects'
 * used by axios
 * 修改以支持http、https 代理服务器
 * 代理模式下，http or https 请求，取决于 proxy 代理服务器，而不是目的服务器。
 */ import stream from 'node:stream';
import { log as Log, name } from '@wiajs/log';
import Request from './request.js';
import utils from './utils.js';
const log = Log({
    env: `wia:req:${name(import.meta.url)}`
}) // __filename
;
/** @typedef { import('./request').Response} Response */ /**
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
 */ /** @typedef {(res: Response, stream?: stream.Readable) => void} Cb*/ const WritebBeenAbortedError = utils.createErrorType('ERR_STREAM_WRITE_BEEN_ABORTED', 'Request stream has been aborted');
(function detectUnsupportedEnvironment() {
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
 */ /**
 * 初始化参数
 * @param {string | Opts} uri/opts
 * @param {Opts | Cb} [opts] /cb
 * @param {Cb} [cb]
 * @returns {{opt: Opts, cb: Cb}}
 */ function init(uri, opts, cb) {
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
            const { url } = opts;
            // 有url，解析
            if (url) {
                // @ts-ignore
                // biome-ignore lint/performance/noDelete: <explanation>
                delete opts.url;
                if (utils.isURL(url)) uri = utils.spreadUrlObject(url);
                else if (utils.isString(url)) uri = utils.spreadUrlObject(utils.parseUrl(url));
            } else {
                // @ts-ignore
                opts = uri // 不判断 utils.validateUrl(uri)
                ;
                uri = {};
            }
        }
        if (utils.isFunction(opts)) {
            // @ts-ignore
            cb = opts;
            opts = {};
        }
        // copy options
        /** @type {Opts} */ const opt = {
            // @ts-ignore
            ...uri,
            ...opts
        };
        if (!utils.isString(opt.host) && !utils.isString(opt.hostname)) opt.hostname = '::1';
        opt.method = (opt.method ?? 'get').toUpperCase();
        // follow-redirects does not skip comparison, so it should always succeed for axios -1 unlimited
        opt.maxBodyLength = opt.maxBodyLength ?? Number.POSITIVE_INFINITY;
        opt.maxRedirects = opt.maxRedirects ?? 21;
        if (opt.maxRedirects === 0) opt.followRedirects = false;
        opt.headers = opt.headers ?? {
            Accept: 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.35',
            'Accept-Encoding': 'gzip, compress, deflate, br'
        };
        R = {
            opt,
            cb
        };
    // log({R}, 'init')
    } catch (e) {
        log.err(e, 'init');
    }
    // @ts-ignore
    return R;
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
 */ function request(uri, opts, callback) {
    let R = null;
    try {
        // @ts-ignore
        const { opt, cb } = init(uri, opts, callback);
        // log.error({uri, options, opts}, 'request')
        const { data, stream } = opt;
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
                data.on('end', ()=>{
                    ended = true;
                });
                data.once('error', /** @param {*} err */ (err)=>{
                    errored = true;
                // req.destroy(err)
                });
                data.on('close', ()=>{
                    if (!ended && !errored) {
                    // throw new WritebBeenAbortedError()
                    }
                });
                // log.error({data}, 'request data.pipe')
                data.pipe(req) // 写入数据流
                ;
            } else {
                // log.error({data}, 'request req.end')
                req.end(data) // 写入数据
                ;
            }
        }
        R = req;
    } catch (e) {
        log.err(e, 'request');
    }
    return R;
}
/**
 * 执行简单的数据（支持stream）请求
 * 非流模式，直接写入数据流，流模式，由管道触发，或手动调用 end() data.pipe 写入数据
 * 复杂数据，请使用 @wiajs/req库（fork from axios），该库封装了当前库，提供了更多功能
 * organize params for patch, post, put, head, del
 * @param {string} verb
 * @returns {(url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void}}
 */ function fn(verb) {
    const method = verb.toUpperCase();
    /**
   *
   * @param {string | Opts} uri /options
   * @param {Opts | Cb} [opts] /callback
   * @param {Cb} [cb] /null
   * @returns
   */ function fn(uri, opts, cb) {
        // @ts-ignore
        opts.method = method;
        return request(uri, opts, cb);
    }
    return fn;
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
export default request;
