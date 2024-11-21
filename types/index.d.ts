export default request;
declare function request(uri: any, options: any, callback: any): Request;
declare namespace request {
    export let get: Request;
    export let head: Request;
    export let options: Request;
    export let post: Request;
    export let put: Request;
    export let patch: Request;
    export let del: Request;
    let _delete: Request;
    export { _delete as delete };
}
import Request from './request.js';
