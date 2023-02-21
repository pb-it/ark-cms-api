const path = require('path');
const fs = require('fs');
const { writeFile } = require('fs').promises;
const axios = require('axios');
const fetch = require("cross-fetch");

const base64 = require(path.join(__dirname, './base64'));

class WebClient {

    _ax;
    _options;

    constructor(config) {
        if (!config) {
            config = {
                headers: {
                    common: {
                        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0'
                    }
                },
                withCredentials: true
            }
        }
        this._ax = axios.create(config);
        this._options = [];
    }

    setOption(url, opt) {
        this._options[url] = opt;
    }

    async get(url, opt) {
        return this._ax.get(url, opt);
    }

    async post(url, obj) {
        return this._ax.post(url, obj);
    }

    async put(url, obj) {
        return this._ax.put(url, obj);
    }

    async delete(url) {
        return this._ax.delete(url);
    }

    async curl(url, opt) {
        var data;
        if (url) {
            var resp = await this._ax.get(url, opt);
            if (resp && resp.data)
                data = resp.data;
        }
        return Promise.resolve(data);
    }

    async download(url, opt, file) {
        if (!opt) {
            var match;
            for (var key in this._options) {
                match = new RegExp(key, 'ig').exec(url);
                if (match) {
                    opt = this._options[key];
                    break;
                }
            }
            if (!opt) {
                if (url.endsWith('.jpg')) {
                    opt = { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' };
                } else
                    opt = {};
            }

        }
        opt['responseType'] = 'stream';
        var stream = await this._ax.get(url, opt);

        var ext;
        var type = stream.headers['content-type'];
        var disposition = stream.headers['content-disposition'];
        if (disposition) {
            ext = disposition.substr(disposition.lastIndexOf('.') + 1);
            if (ext.endsWith('"'))
                ext = ext.substr(0, ext.length - 1);
        } else if (type) {
            var parts = type.split('/');
            if (parts.length == 2)
                ext = parts[1];
        }
        if (ext) {
            var index = file.lastIndexOf('.');
            if (index == -1)
                file += '.' + ext;
            else {
                var current = file.substr(index + 1);
                if (current != ext)
                    file = file.substr(0, index + 1) + ext;
            }
        }

        if (fs.existsSync(file))
            throw new Error("File '" + file + "' already exists!");

        await this._streamToFile(stream, file);

        var name;
        var index = file.lastIndexOf(path.sep);
        if (index >= 0)
            name = file.substr(index + 1);
        else
            name = file;
        return Promise.resolve(name);
    }

    async _streamToFile(stream, file) {
        return new Promise((resolve, reject) => {
            var err;
            const writer = fs.createWriteStream(file);
            writer.on('error', error => {
                err = error;
                writer.close();
                reject(error);
            });
            writer.on('close', () => {
                if (err) {
                    if (file && fs.existsSync(file))
                        fs.unlinkSync(file);
                } else
                    resolve();
            });
            stream.data.pipe(writer);
        });
    }

    async isImage(url) {
        return new Promise(async function (resolve) {
            var opt = {
                'responseType': 'stream'
            }
            var stream = await this._ax.get(url, opt);
            console.log(stream.headers['content-type']);
            var match = stream.headers['content-type'].match(/(image)+\//g);
            resolve(match && match.length != 0);
        });
    }

    async fetchBlob(url) {
        return fetch(url).then(r => r.blob());
    }

    async fetchBase64(url) {
        var response = await fetch(url);
        var contentType = response.headers.get('Content-Type');
        var buffer = await response.buffer();
        return base64.getStringFromBuffer(contentType, buffer);
    }

    async fetchFile(url, file) {
        var response = await fetch(url);
        var buffer = await response.buffer();
        return writeFile(file, buffer);
    }
}

module.exports = WebClient;