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

/**
 * encode for HTML / prevent interpretation of tags: '<meta>' -> '&lt;meta;&gt;'
 * @param {*} text 
 * @returns 
 */
function encodeText(text) {
    //return text.replace(/<link>([A-ZÄÖÜa-zäöüß@µ§$%!?0-9_\s\/\\\=\:\.\'\"\;\,\#\&\|\-\+\~\*\>]*)<\/link>/g, '<a href="$1">$1</a>');
    text = text.replace(/[\u00A0-\u9999<>\&]/g, function (i) {
        return '&#' + i.charCodeAt(0) + ';';
    });
    return replaceLineBreak(replaceTab(replaceApostrophe(text)));
}

function replaceApostrophe(str) {
    return (str + '').replace(/'/g, '&apos;');
}

function replaceLineBreak(str) {
    return (str + '').replace(/(?:\r\n|\r|\n)/g, '<br>');
}

function replaceTab(str) {
    return (str + '').replace(/\t/g, '&nbsp;&nbsp;&nbsp;');
}

function addSlashes(str) {
    return (str + '').replace(/[\\"']/g, '\\$&').replace(/\u0000/g, '\\0');
}

module.exports = { sleep, exec, getAllPropertyNames, flatten, getFileExtensionFromUrl, encodeText, replaceApostrophe, replaceLineBreak, replaceTab, addSlashes };