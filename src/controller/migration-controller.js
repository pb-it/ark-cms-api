const Logger = require('../logger');

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

    _controller;
    _shelf;
    _models;

    constructor(controller) {
        this._controller = controller;
        this._shelf = this._controller.getShelf();
        this._models = this._shelf.getModels();
    }

    updateDatabase(currentVersion, newVersion) {
        var definition;
        for (var m of this._models) {
            definition = m.getDefinition();
            MigrationController.updateModelDefinition(definition, currentVersion, newVersion);
            this._shelf.upsertModel(undefined, definition);
        }
        Logger.info("[MigrationController] ✔ Updated models in database to version '" + newVersion + "'");
    }
}

module.exports = MigrationController;