const fs = require('fs');

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