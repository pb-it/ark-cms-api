const path = require('path');

const AppVersion = require('../common/app-version');

class VersionController {

    _controller;

    _version;

    constructor(controller) {
        this._controller = controller;

        var pkg = require(path.join(__dirname, '../../package.json'));
        this._version = new AppVersion(pkg['version']);
    }

    getVersion() {
        return this._version;
    }
}

module.exports = VersionController;