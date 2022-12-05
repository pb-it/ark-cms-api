const path = require('path');
const fs = require('fs');
const axios = require('axios').default;

async function getHeaders() {
    var headers;
    var userAgent = await controller.getRegistry().get('user-agent');
    if (!userAgent)
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0';
    headers = {
        'User-Agent': userAgent
    }
    return Promise.resolve(headers);
}

module.exports.curl = async function (url) {
    var data;
    if (url) {
        var resp = await axios.get(url);
        if (resp && resp.data)
            data = resp.data;
    }
    return Promise.resolve(data);
}

module.exports.get = async function (url) {
    return axios.get(url);
}

module.exports.post = async function (url, obj) {
    return axios.post(url, obj);
}

module.exports.put = async function (url, obj) {
    return axios.put(url, obj);
}

module.exports.delete = async function (url) {
    return axios.delete(url);
}

module.exports.fetchBlob = async function (url) {
    var data;
    if (url) {
        var resp = await axios.get(url, { responseType: 'blob' });
        if (resp && resp.data)
            data = resp.data;
    }
    return Promise.resolve(data);
}

async function download(url, file) {
    var opt = {
        'responseType': 'stream',
        'headers': await getHeaders()
    }
    var stream = await axios.get(url, opt);

    var name;
    var index = file.lastIndexOf(path.sep);
    if (index >= 0)
        name = file.substr(index + 1);
    else
        name = file;
    if (name.indexOf('.') == -1) {
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
            name += '.' + ext;
            file += '.' + ext;
        }
    }

    if (fs.existsSync(file))
        throw new Error("File already exists");

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
                resolve(name);
        });

        stream.data.pipe(writer);
    });
}

async function tryDownload(url, file) {
    var result;
    try {
        result = await download(url, file);
    } catch (err) {
        console.log(err);
    }
    return Promise.resolve(result);
}

module.exports.isImage = function (url) {
    return new Promise(async function (resolve) {
        var opt = {
            'responseType': 'stream',
            'headers': await getHeaders()
        }
        var stream = await axios.get(url, opt);
        console.log(stream.headers['content-type']);
        var match = stream.headers['content-type'].match(/(image)+\//g);
        resolve(match && match.length != 0);
    });
}

module.exports.download = download;
module.exports.tryDownload = tryDownload;