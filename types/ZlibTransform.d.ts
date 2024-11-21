export default ZlibTransform;
declare class ZlibTransform extends stream.Transform {
    __transform(chunk: any, encoding: any, callback: any): void;
    _transform(chunk: any, encoding: any, callback: any): void;
}
import stream from 'node:stream';
