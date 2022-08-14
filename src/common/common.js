/**
 * extension without dot
 * @param {*} url 
 * @returns 
 */
module.exports.getFileExtensionFromUrl = function (url) {
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