/**
 * from 'https://github.com/follow-redirects/follow-redirects'
 * 修改以支持http、https 代理服务器
 * 代理模式下，http or https 请求，取决于 proxy 代理服务器，而不是目的服务器。
 */ import { log as Log, name } from '@wiajs/log';
import Request from './request.js';
import utils from './utils.js';
const log = Log({
    env: `wia:req:${name(import.meta.url)}`
}) // __filename
;
(function detectUnsupportedEnvironment() {
    const looksLikeNode = typeof process !== 'undefined';
    const looksLikeBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    const looksLikeV8 = utils.isFunction(Error.captureStackTrace);
    if (!looksLikeNode && (looksLikeBrowser || !looksLikeV8)) {
        console.warn('The follow-redirects package should be excluded from browser builds.');
    }
})();
/**
 * 封装http(s)，实现重定向
 * 重定向可能切换http、https
 * 支持隧道及非隧道、http(s)代理
 */ /**
 * 初始化参数
 * @param {*} uri
 * @param {*} options
 * @param {*} callback
 * @returns
 */ function init(uri, options, callback) {
    let R;
    try {
        // Parse parameters, ensuring that input is an object
        if (utils.isURL(uri)) uri = utils.spreadUrlObject(uri);
        else if (utils.isString(uri)) uri = utils.spreadUrlObject(utils.parseUrl(uri));
        else {
            callback = options;
            options = utils.validateUrl(uri);
            uri = {};
        }
        if (utils.isFunction(options)) {
            callback = options;
            options = null;
        }
        // copy options
        options = {
            ...uri,
            ...options
        };
        if (!utils.isString(options.host) && !utils.isString(options.hostname)) options.hostname = '::1';
        R = {
            opts: options,
            cb: callback
        };
    // log({R}, 'init')
    } catch (e) {
        log.err(e, 'init');
    }
    return R;
}
/**
 * Executes a request, following redirects
 * 替换原 http(s).request，参数类似
 * 注意变参 (options[, callback]) or (url[, options][, callback])
    maxRedirects: _.maxRedirects,
    maxBodyLength: _.maxBodyLength,
 * @param {*} uri/options
 * @param {*} options/callback
 * @param {*} callback/null
 * @returns
 */ function request(uri, options, callback) {
    let R = null;
    try {
        log({
            uri,
            options
        }, 'request');
        const { opts, cb } = init(uri, options, callback);
        R = new Request(opts, cb);
    } catch (e) {
        log.err(e, 'request');
    }
    return R;
}
/**
 * 执行简单的非stream数据请求
 * 复杂数据，请使用 @wiajs/req库（fork from axios），该库封装了当前库，提供了更多功能
 * organize params for patch, post, put, head, del
 * @param {string} verb
 * @returns {Request} Duplex 流
 */ function fn(verb) {
    const method = verb.toUpperCase();
    // @ts-ignore
    return (uri, options, callback)=>{
        const { opts, cb } = init(uri, options, callback);
        opts.method = method;
        const req = new Request(opts, cb);
        req.end();
        return req;
    };
}
// define like this to please codeintel/intellisense IDEs
request.get = fn('get');
request.head = fn('head');
request.options = fn('options');
request.post = fn('post');
request.put = fn('put');
request.patch = fn('patch');
request.del = fn('delete');
request['delete'] = fn('delete');
export default request;
