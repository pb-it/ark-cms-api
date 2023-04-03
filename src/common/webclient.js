const path = require('path');
const fs = require('fs');
const { writeFile } = require('fs').promises;
const axios = require('axios');
const fetch = require("cross-fetch");

const Logger = require(path.join(__dirname, './logger/logger'));
const base64 = require(path.join(__dirname, './base64'));

class WebClient {

    static _progress(progressEvent) {
        const total = parseFloat(progressEvent.currentTarget.responseHeaders['Content-Length'])
        const current = progressEvent.currentTarget.response.length

        let percentCompleted = Math.floor(current / total * 100);
        console.log('completed: ', percentCompleted);
    }

    static async wget(target, url) {
        return new Promise((resolve, reject) => {
            var bError = false;
            const process = require("child_process").spawn('wget', ['-O', target, url]);

            process.stdout.on('data', function (data) {
                console.log(`stdout:\n${data}`);
            });
            process.stderr.on('data', function (data) {
                //console.error(`stderr: ${data}`);
                if (data.indexOf('404 Not Found') != -1)
                    bError = true;
            });

            process.on('close', function (resp) {
                if (bError) {
                    if (fs.existsSync(target))
                        fs.unlinkSync(target);
                    reject();
                } else
                    resolve(resp);
            });
            process.on('error', function (err) {
                reject(err);
            });
        });
    }

    _ax;
    _options;
    _bDebug;

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

        var debug = controller.getServerConfig()['debug'];
        if (debug) {
            if (debug['download'])
                this._bDebug = true;

            if (debug['axios'])
                this._ax.interceptors.request.use(request => {
                    console.log('Starting Request', JSON.stringify(request, null, 2));
                    return request;
                });
        }
    }

    getAxios() {
        return this._ax;
    }

    setOption(url, opt) {
        this._options[url] = opt;
    }

    async get(url, opt) {
        return this._ax.get(url, opt);
    }

    async post(url, obj, opt) {
        return this._ax.post(url, obj, opt);
    }

    async put(url, obj, opt) {
        return this._ax.put(url, obj, opt);
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

    async download(url, config, file) {
        if (this._bDebug) {
            var start = Date.now();
            Logger.info('[App] Start: ' + new Date(start).toISOString());
        }

        var fpath;
        var name;
        var ext;
        var index = file.lastIndexOf(path.sep);
        if (index >= 0) {
            fpath = file.substr(0, index);
            name = file.substr(index + 1);
        } else
            name = file;
        index = name.lastIndexOf('.');
        if (index != -1)
            ext = name.substr(index + 1);

        if (!config) {
            var match;
            for (var key in this._options) {
                match = new RegExp(key, 'ig').exec(url);
                if (match) {
                    config = this._options[key];
                    break;
                }
            }
        }
        if (!config || !config['client'] || config['client'] == 'axios') {
            var opt;
            if (config && config['options'])
                opt = config['options'];
            else
                opt = {};
            opt['responseType'] = 'stream';
            //opt['onDownloadProgress'] = WebClient._progress;
            var stream = await this._ax.get(url, opt);

            var extFromHeader;
            var type = stream.headers['content-type'];
            var disposition = stream.headers['content-disposition'];
            if (disposition) {
                extFromHeader = disposition.substr(disposition.lastIndexOf('.') + 1);
                if (extFromHeader.endsWith('"'))
                    extFromHeader = extFromHeader.substr(0, extFromHeader.length - 1);
            } else if (type) {
                var parts = type.split('/');
                if (parts.length == 2)
                    extFromHeader = parts[1];
                parts = extFromHeader.split(';');
                extFromHeader = parts[0];
            }
            if (extFromHeader) {
                var bChanged = false;
                if (!ext) {
                    name += '.' + extFromHeader;
                    bChanged = true;
                } else if (ext != extFromHeader) {
                    var pic = ['jpg', 'jpeg', 'webp'];
                    if (!pic.includes(ext) || !pic.includes(extFromHeader)) {
                        name = name.substr(0, index + 1) + extFromHeader;
                        bChanged = true;
                    }
                }
                if (bChanged) {
                    if (fpath)
                        file = `${fpath}${path.sep}${name}`;
                    else
                        file = name;
                }
            }

            if (fs.existsSync(file))
                throw new Error("File '" + file + "' already exists!");

            if (this._bDebug) {
                const contentLength = stream.headers['content-length'];
                var total = 0;
                var percentage = 0;
                var last = 0;
                stream.data.on('data', (chunk) => {
                    total += chunk.length;
                    percentage = ((total / contentLength) * 100);
                    if (percentage - last > 1) {
                        last = percentage;
                        console.log(percentage.toFixed(2) + "%");
                    }
                });
            }

            //stream.data.pipe(fs.createWriteStream(file));
            await this._streamToFile(stream, file);
        } else if (config['client'] == 'fetch') {
            await this.fetchFile(url, file);
        } else if (config['client'] == 'wget') {
            await WebClient.wget(file, url);
        }

        if (this._bDebug) {
            var end = Date.now();
            Logger.info('[App] End: ' + new Date(end).toISOString());
            var duration = (end - start) / 1000;
            Logger.info('[App] Duration: ' + duration.toFixed(2) + ' sec');

            var stats = fs.statSync(file);
            var size = stats.size / (1024 * 1024);
            Logger.info('[App] Size: ' + size.toFixed(2) + 'MB');

            Logger.info('[App] Speed: ' + (size / duration).toFixed(2) + 'MB/s');
        }

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

    async fetchJson(url, opt) {
        return fetch(url, opt).then((response) => response.json());
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