const path = require('path');
const axios = require('axios').default;
const fs = require('fs');

const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3750.0 Iron Safari/537.36'
    //Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:92.0) Gecko/20100101 Firefox/92.0
}

module.exports.curl = async function request(url) {
    var data;
    if (url) {
        var resp = await axios.get(url);
        if (resp && resp.data)
            data = resp.data;
    }
    return Promise.resolve(data);
}

module.exports.post = async function request(url, obj) {
    return axios.post(url, obj);
}

module.exports.put = async function request(url, obj) {
    return axios.put(url, obj);
}

async function download(url, file) {
    var opt = {
        'responseType': 'stream',
        'headers': headers
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

module.exports.download = download;
module.exports.tryDownload = tryDownload;