const Logger = require('../common/logger/logger');
const AppVersion = require('../common/app-version');

class MigrationController {

    static updateModelDefinition(definition, currentVersion, newVersion) {
        switch (currentVersion) {
            case '0.1.0-beta':
                for (let attribute of definition['attributes']) {
                    if (attribute['dataType'] === "enumeration")
                        attribute['options'] = attribute['options'].map(function (x) { return { 'value': x } });
                }
                if (newVersion && newVersion === '0.1.1-beta')
                    break;
            default:
        }
        return definition;
    }

    static compatible(oldVersion, newVersion) {
        return (oldVersion.major === newVersion.major && oldVersion.minor === newVersion.minor);
    }

    _controller;
    _shelf;
    _models;

    constructor(controller) {
        this._controller = controller;
        this._shelf = this._controller.getShelf();
        this._models = this._shelf.getModels();
    }

    async migrateDatabase(bForce) {
        var appVersion = this._controller.getVersionController().getVersion();
        var sAppVersion = appVersion.toString();
        var sRegVersion = await this._controller.getRegistry().get('version');
        if (sRegVersion) {
            if (sRegVersion === sAppVersion)
                Logger.info("[MigrationController] ✔ Current application version '" + sAppVersion + "' equals registry entry of database");
            else {
                Logger.info("[MigrationController] ✘ Current application version '" + sAppVersion + "' does not equal registry entry of database - starting migration");
                var regVersion = new AppVersion(sRegVersion);
                if (MigrationController.compatible(regVersion, appVersion) || bForce) {
                    await this._migrateAllModels(sRegVersion, sAppVersion);
                    Logger.info("[MigrationController] ✔ Updated all models in database to version '" + sAppVersion + "'");
                    await this._controller.getRegistry().upsert('version', sAppVersion);
                } else {
                    Logger.info("[MigrationController] ✘ An update of the minor release version may result in faulty models! Force only after studying changelog!");
                    return Promise.resolve(false);
                }
            }
        } else {
            Logger.info("[MigrationController] Initialized registry entry of database with current application version '" + sAppVersion + "'");
            await this._controller.getRegistry().upsert('version', sAppVersion);
        }
        return Promise.resolve(true);
    }

    async _migrateAllModels(currentVersion, newVersion) {
        var definition;
        if (this._models) {
            for (var m of this._models) {
                definition = m.getDefinition();
                MigrationController.updateModelDefinition(definition, currentVersion, newVersion);
                this._shelf.upsertModel(undefined, definition);
            }
        }
        return Promise.resolve();
    }
}

module.exports = MigrationController;