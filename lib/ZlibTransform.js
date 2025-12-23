import stream from 'stream';
let ZlibTransform = class ZlibTransform extends stream.Transform {
    /**
   *
   * @param {*} chunk
   * @param {*} encoding
   * @param {*} callback
   */ __transform(chunk, encoding, callback) {
        this.push(chunk);
        callback();
    }
    /**
   *
   * @param {*} chunk
   * @param {*} encoding
   * @param {*} callback
   */ _transform(chunk, encoding, callback) {
        if (chunk.length !== 0) {
            this._transform = this.__transform;
            // Add Default Compression headers if no zlib headers are present
            if (chunk[0] !== 120) {
                // Hex: 78
                const header = Buffer.alloc(2);
                header[0] = 120 // Hex: 78
                ;
                header[1] = 156 // Hex: 9C
                ;
                this.push(header, encoding);
            }
        }
        this.__transform(chunk, encoding, callback);
    }
};
export default ZlibTransform;
