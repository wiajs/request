declare namespace _default {
    export { createErrorType };
    export { InvalidUrlError };
    export { isString };
    export { isArray };
    export { isBuffer };
    export { isUndefined };
    export { isNumber };
    export { isBoolean };
    export { isFunction };
    export { isObject };
    export { isURL };
    export { isReadStream };
    export { noop };
    export { parseUrl };
    export { spreadUrlObject };
    export { validateUrl };
    export { resolveUrl };
    export { noBody };
}
export default _default;
export type CustomErrorInstance = {
    code: string;
    message: string;
    cause: Error | undefined;
};
declare function createErrorType(code: string, message: string, baseClass?: typeof Error): typeof Error & {
    new (properties?: object): CustomErrorInstance;
};
declare const InvalidUrlError: ErrorConstructor & (new (properties?: object) => CustomErrorInstance);
declare function isString(thing: any): boolean;
declare const isArray: (arg: any) => arg is any[];
declare function isBuffer(val: any): boolean;
declare function isUndefined(thing: any): boolean;
declare function isNumber(thing: any): boolean;
declare function isBoolean(thing: any): boolean;
declare function isFunction(thing: any): boolean;
declare function isObject(thing: any): boolean;
declare function isURL(value: any): boolean;
declare function isReadStream(rs: any): any;
declare function noop(): void;
declare function parseUrl(input: any): any;
declare function spreadUrlObject(urlObject: any, target: any): any;
declare function validateUrl(input: any): any;
declare function resolveUrl(relative: any, base: any): any;
declare function noBody(method: string, code: number): boolean;
