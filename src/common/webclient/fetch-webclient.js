const debug = require('debug');
const log = debug('app:webclient');
const path = require('path');
const { writeFile } = require('fs').promises;
const https = require('https');
//const fetch = require('node-fetch');
const fetch = require('cross-fetch');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

const WebClient = require(path.join(__dirname, './webclient.js'));
const Logger = require(path.join(__dirname, '../logger/logger.js'));
const HttpError = require(path.join(__dirname, '../http-error.js'));
const base64 = require(path.join(__dirname, '../base64.js'));

class FetchWebClient extends WebClient {

    static async _parseResponse(response) {
        var res = {};
        res['status'] = response.status;
        res['statusText'] = response.statusText;
        res['url'] = response.url;
        res['headers'] = response.headers;
        res['redirected'] = response.redirected;
        res['type'] = response.type;
        if (response.ok) {
            if (response.headers.get('content-type')?.includes('application/json'))
                res['body'] = await response.json();
            else
                res['body'] = await response.text();
        } else
            res['body'] = await response.text();
        return Promise.resolve(res);
    }

    static async _fetch(url, method, data, options) {
        log(method + ': ' + url);
        if (debug.enabled('app:webclient')) {
            var str;
            if (options)
                str = JSON.stringify(options, null, '\t');
            else
                str = 'null';
            Logger.info('[webclient] options:\n' + str);
        }
        var res;
        var opt;
        var bMeta;
        if (options) {
            opt = { ...options };
            if (opt.hasOwnProperty('meta')) {
                bMeta = opt['meta'];
                delete opt['meta'];
            }
            if (opt.hasOwnProperty('rejectUnauthorized')) {
                if (opt['rejectUnauthorized'] === false)
                    opt['agent'] = httpsAgent;
                delete opt['rejectUnauthorized'];
            }
            var formData;
            if (opt.hasOwnProperty('formdata')) {
                formData = new FormData();
                for (const name in opt['formdata']) {
                    formData.append(name, opt['formdata'][name]);
                }
                delete opt['formdata'];
            }
            if (formData)
                opt['body'] = new URLSearchParams(formData);
        }
        if (data) {
            if (opt)
                opt['body'] = data;
            else
                opt = { 'body': data };
        }
        var response;
        switch (method) {
            case 'GET':
                response = await fetch(url, opt);
                break;
            case 'POST':
            case 'PUT':
                if (!opt)
                    opt = {};
                opt['method'] = method;
                if (data) {
                    if (!opt['headers']) {
                        /*if (data instanceof FormData)
                            opt['headers'] = {
                                'Content-Type': 'multipart/form-data'
                            };*/
                        if (!(data instanceof FormData) && typeof data === 'object')
                            opt['headers'] = {
                                'Content-Type': 'application/json'
                            };
                    }
                    if (typeof data === 'string' || data instanceof String || data instanceof FormData)
                        opt['body'] = data;
                    else
                        opt['body'] = JSON.stringify(data);
                }
                response = await fetch(url, opt);
                break;
            case 'DELETE':
                if (!opt)
                    opt = {};
                opt['method'] = method;
                response = await fetch(url, opt);
                break;
            default:
                throw new Error('Unsupported method \'' + method + '\'');
        }
        var res;
        if (response) {
            if (bMeta)
                res = await FetchWebClient._parseResponse(response);
            else if (response.ok) {
                if (response.headers.get('content-type')?.includes('application/json'))
                    res = await response.json();
                else
                    res = await response.text();
            } else
                throw new HttpError(null, await FetchWebClient._parseResponse(response));
        } else
            throw new Error('An unexpected error has occurred');
        return Promise.resolve(res);
    }

    constructor() {
        super('fetch');
    }

    async get(url, options) {
        return this.request(url, 'GET', null, options);
    }

    async post(url, data, options) {
        return this.request(url, 'POST', data, options);
    }

    async put(url, data, options) {
        return this.request(url, 'PUT', data, options);
    }

    async delete(url) {
        return this.request(url, 'DELETE');
    }

    async request(url, method, data, options) {
        return FetchWebClient._fetch(url, method, data, options);
    }

    async getBuffer(url) {
        return fetch(url).then(r => r.buffer());
    }

    async getBlob(url) {
        return fetch(url).then(r => r.blob());
    }

    async getBase64(url) {
        log('BASE64: ' + url);
        var res;
        const response = await fetch(url);
        if (response.ok) {
            const contentType = response.headers.get('Content-Type');
            const buffer = await response.buffer();
            res = base64.getStringFromBuffer(contentType, buffer);
        } else
            throw new HttpError(null, await FetchWebClient._parseResponse(response));
        return Promise.resolve(res);
    }

    async download(url, file, options) {
        log('DOWNLOAD: ' + url);
        var res;
        var name;
        var index = file.lastIndexOf(path.sep);
        if (index >= 0)
            name = file.substr(index + 1);
        else
            name = file;

        var opt;
        if (options) {
            opt = { ...options };
            if (opt.hasOwnProperty('rejectUnauthorized')) {
                if (opt['rejectUnauthorized'] === false)
                    opt['agent'] = httpsAgent;
                delete opt['rejectUnauthorized'];
            }
        }
        const response = await fetch(url, opt);
        if (response.ok) {
            const buffer = await response.buffer();
            await writeFile(file, buffer);
            res = name;
        } else
            throw new HttpError(null, await FetchWebClient._parseResponse(response));
        return Promise.resolve(res);
    }
}

module.exports = FetchWebClient;