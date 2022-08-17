class AppVersion {

    _str;

    major;
    minor;
    patch;
    build;

    constructor(str) {
        this._parse(str);
    }

    _parse(str) {
        this._str = str;
        var arr = this._str.split('-');
        if (arr.length > 1)
            this.build = arr[1];

        arr = arr[0].split('.');
        if (arr.length === 3) {
            this.major = parseInt(arr[0]);
            this.minor = parseInt(arr[1]);
            this.patch = parseInt(arr[2]);
        } else
            throw new Error('Failed to parse version');
    }

    toString() {
        return this._str;
    }
}

module.exports = AppVersion;