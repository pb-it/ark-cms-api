const fs = require('fs');

module.exports.getExtension = function (data) {
    var ext;
    if (data.startsWith("data:")) {
        var start = data.indexOf("/");
        var end = data.indexOf(";");
        if (start > 0 && end > 0)
            ext = data.substring(start + 1, end);
    }
    if (!ext) {
        console.log(data.substring(0, 20));
        throw new Error("unknown filetype");
    }
    return ext;
}

module.exports.createFile = function (filePath, data) {
    if (filePath) {
        if (!fs.existsSync(filePath)) {
            var base64 = data.split(';base64,').pop();
            if (base64)
                fs.writeFileSync(filePath, base64, { encoding: 'base64' });
        } else
            throw new Error("File already exists");
    }
}