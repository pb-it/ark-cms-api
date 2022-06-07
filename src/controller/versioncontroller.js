const Logger = require('../logger');

class VersionController {

    _registry;

    _version;

    constructor(registry) {
        this._registry = registry;
        this._version = '0.1.0-beta';
    }

    async verify() {
        var value = await this._registry.get('version');
        if (value) {
            if (value === this._version)
                Logger.info("[VersionController] ✔ Current application version '" + this._version + "' equals registry entry of database");
            else
                ;//TODO: upgrade
        } else {
            Logger.info("[VersionController] Initialized registry entry of database with current application version '" + this._version + "'");
            await this._registry.upsert('version', this._version);
        }
        return Promise.resolve();
    }
}

module.exports = VersionController;