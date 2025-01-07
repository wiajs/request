export default request;
export type Response = import("./request").Response;
export type Opts = {
    headers?: {
        [x: string]: string;
    };
    url?: string;
    protocol?: "http:" | "https:";
    host?: string;
    hostname?: string;
    family?: string;
    path?: string;
    method?: string;
    agent?: any;
    agents?: any;
    body?: any;
    data?: any;
    stream?: boolean;
    decompress?: boolean;
    transformStream?: any;
    beforeRedirect?: any;
    followRedirects?: boolean;
    maxRedirects?: number;
    maxBodyLength?: number;
    trackRedirects?: any;
};
export type Cb = (res: Response, stream?: stream.Readable) => void;
declare function request(uri: string | Opts, opts?: Opts | Cb, callback?: Cb): Request;
declare namespace request {
    export let get: (url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void;
    export let head: (url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void;
    export let options: (url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void;
    export let post: (url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void;
    export let put: (url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void;
    export let patch: (url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void;
    export let del: (url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void;
    let _delete: (url: string | Opts, opts?: Opts | Cb, cb?: Cb) => void;
    export { _delete as delete };
}
import stream from 'node:stream';
import Request from './request.js';
