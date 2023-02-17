const Logger = require('../common/logger/logger');
const AppVersion = require('../common/app-version');

/**
 * dbHelper.js
 * @param {*} knex 
 * @param {*} tableName 
 * @param {*} columnName 
 * @returns 
 */
const dropColumn = (knex, tableName, columnName) => {
    return knex.schema.hasColumn(tableName, columnName).then((hasColumn) => {
        if (hasColumn) {
            return knex.schema.alterTable(tableName, table => {
                table.dropColumn(columnName);
            });
        } else
            return null;
    });
}

class MigrationController {

    static updateModelDefinition(definition, currentVersion, newVersion) {
        var sCurrentVersion = currentVersion.toString();
        var sNewVersion;
        if (newVersion)
            sNewVersion = newVersion.toString();
        if (!sNewVersion || (sCurrentVersion !== sNewVersion)) {
            switch (sCurrentVersion) {
                case '0.1.0-beta':
                    for (let attribute of definition['attributes']) {
                        if (attribute['dataType'] === "enumeration")
                            attribute['options'] = attribute['options'].map(function (x) { return { 'value': x } });
                    }
                    if (sNewVersion === '0.1.1-beta')
                        break;
                case '0.1.1-beta':
                case '0.1.2-beta':
                    if (sNewVersion === '0.2.0-beta')
                        break;
                case '0.2.0-beta':
                    var defaults = definition['defaults'];
                    if (defaults) {
                        var panelType = defaults['paneltype'];
                        if (panelType) {
                            if (defaults['view'])
                                defaults['view']['panelType'] = panelType
                            else
                                defaults['view'] = { 'panelType': panelType };
                            delete defaults['paneltype'];
                        }
                    }
                    if (sNewVersion === '0.2.1-beta')
                        break;
                case '0.2.1-beta':
                    var extensions = definition['extensions'];
                    if (extensions)
                        extensions = { 'server': extensions };
                    var actions = definition['actions'];
                    if (actions && actions['init']) {
                        if (extensions)
                            extensions['client'] = actions['init'];
                        else
                            extensions = { 'client': actions['init'] };
                        delete definition['actions'];
                    }
                    if (extensions)
                        definition['extensions'] = extensions;
                    break;
                default:
            }
        }
        return definition;
    }

    static compatible(oldVersion, newVersion) {
        return (oldVersion.major === newVersion.major && oldVersion.minor === newVersion.minor && oldVersion.patch <= newVersion.patch);
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
                var knex = this._controller.getKnex();
                switch (sRegVersion) {
                    case '0.1.0-beta':
                    case '0.1.1-beta':
                    case '0.1.2-beta':
                    case '0.2.0-beta':
                        if (await knex.schema.hasTable('_log')) {
                            await knex.schema.dropTable('_change'); // created while starting application
                            await knex.schema.renameTable('_log', '_change');
                        }
                    case '0.2.1-beta':
                        dropColumn(knex, '_model', 'name');
                    case '0.3.0-beta':
                        var mChange = this._shelf.getModel('_change');
                        if (mChange) {
                            var def = mChange.getDefinition();
                            def['attributes'].push({
                                "name": "user",
                                "dataType": "relation",
                                "model": "_user"
                            });
                            await this._shelf.upsertModel(mChange.getId(), def);
                        }
                        var mModel = this._shelf.getModel('_model');
                        if (mModel) {
                            var def = mModel.getDefinition();
                            if (!def['options']['timestamps']) {
                                def['options']['timestamps'] = true;
                                await this._shelf.upsertModel(mModel.getId(), def);
                            }
                        }
                    case '0.3.2-beta':
                    case '0.4.0-beta':
                        var mUser = this._shelf.getModel('_user');
                        if (mUser) {
                            var def = mUser.getDefinition();
                            for (var attr of def['attributes']) {
                                if (attr['name'] == 'password') {
                                    attr['length'] = 96;
                                    break;
                                }
                            }
                            await this._shelf.upsertModel(mUser.getId(), def);
                        }
                        break;
                    default:
                }

                var regVersion = new AppVersion(sRegVersion);
                if (MigrationController.compatible(regVersion, appVersion) || bForce) {
                    var definition;
                    if (this._models) {
                        for (var m of this._models) {
                            definition = m.getDefinition();
                            MigrationController.updateModelDefinition(definition, regVersion, appVersion);
                            await this._shelf.upsertModel(undefined, definition, false);
                        }
                    }
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
}

module.exports = MigrationController;