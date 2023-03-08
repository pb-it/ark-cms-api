async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function exec(cmd) {
    return new Promise((resolve, reject) => {
        require("child_process").exec(cmd, function (err, stdout, stderr) {
            if (err)
                reject(err);
            else {
                resolve(stdout);
            }
        });
    });
}

function getAllPropertyNames(obj) {
    var props = [];
    do {
        Object.getOwnPropertyNames(obj).forEach((prop) => {
            if (props.indexOf(prop) === -1)
                props.push(prop);
        });
    } while ((obj = Object.getPrototypeOf(obj)));
    return props;
};

/**
 * copies inherited poperties to new object prototype-free object
 * https://stackoverflow.com/questions/8779249/how-to-stringify-inherited-objects-to-json
 * @param {*} obj 
 * @returns 
 */
function flatten(obj) {
    var newObj = {};
    var props = getAllPropertyNames(obj);
    props.forEach((prop) => {
        newObj[prop] = obj[prop];
    });
    return newObj;
}

/**
 * extension without dot
 * @param {*} url 
 * @returns 
 */
function getFileExtensionFromUrl(url) {
    var ext;
    if (url) {
        var index = url.indexOf('?');
        if (index >= 0) {
            url = url.substring(0, index);
        }
        index = url.lastIndexOf('/');
        if (index >= 0) {
            url = url.substring(index + 1);
        }
        index = url.lastIndexOf('.');
        if (index >= 0) {
            ext = url.substring(index + 1);
        }
    }
    return ext;
}

module.exports = { sleep, exec, getAllPropertyNames, flatten, getFileExtensionFromUrl };