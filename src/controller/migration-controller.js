const Logger = require('../logger');

class MigrationController {

    _controller;
    _shelf;
    _models;

    constructor(controller) {
        this._controller = controller;
        this._shelf = this._controller.getShelf();
        this._models = this._shelf.getModels();
    }

    update(currentVersion, newVersion) {
        var definition;
        switch (currentVersion) {
            case '0.1.0-beta':
                for (var m of this._models) {
                    definition = m.getData();
                    for (let attribute of definition['attributes']) {
                        if (attribute['dataType'] === "enumeration")
                            attribute['options'] = attribute['options'].map(function (x) { return { 'value': x } });
                    }
                    this._shelf.upsertModel(definition);
                }
                if (newVersion && newVersion === '0.1.1-beta')
                    break;
            default:
        }

        Logger.info("[MigrationController] ✔ Updated to version '" + newVersion + "'");
    }
}

module.exports = MigrationController;