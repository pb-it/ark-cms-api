const path = require('path');
const Logger = require('../logger');

class VersionController {

    _controller;
    _registry;

    _version;

    constructor(controller) {
        this._controller = controller;
        this._registry = this._controller.getRegistry();

        var pkg = require(path.join(__dirname, "../../", "package.json"));
        this._version = pkg['version'];
    }

    getVersion() {
        return this._version;
    }

    async verify() {
        var value = await this._registry.get('version');
        if (value) {
            if (value === this._version)
                Logger.info("[VersionController] ✔ Current application version '" + this._version + "' equals registry entry of database");
            else {
                Logger.info("[VersionController] ✘ Current application version '" + this._version + "' does not equal registry entry of database - starting migration");
                await this._controller.getMigrationsController().updateDatabase(value, this._version);
                await this._registry.upsert('version', this._version);
            }
        } else {
            Logger.info("[VersionController] Initialized registry entry of database with current application version '" + this._version + "'");
            await this._registry.upsert('version', this._version);
        }
        return Promise.resolve();
    }
}

module.exports = VersionController;