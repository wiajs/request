export function httpify(resp: any, headers: any): Caseless;
export default class Caseless {
    constructor(dict: any);
    dict: any;
    set(name: any, value: any, clobber: any): string | false;
    has(name: string): string | false;
    get(name: string): any;
    swap(name: string): void;
    del(name: string): boolean;
}
