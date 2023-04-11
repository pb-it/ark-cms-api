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
                case '0.3.0-beta':
                case '0.3.2-beta':
                case '0.4.0-beta':
                case '0.4.1-beta':
                case '0.4.2-beta':
                case '0.4.3-beta':
                case '0.4.4-beta':
                case '0.4.5-beta':
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
        var appVersion = this._controller.getVersionController().getPkgVersion();
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
                            await mChange.initModel();
                        }
                        var mModel = this._shelf.getModel('_model');
                        if (mModel) {
                            var def = mModel.getDefinition();
                            if (!def['options']['timestamps']) {
                                def['options']['timestamps'] = true;
                                await this._shelf.upsertModel(mModel.getId(), def);
                                await mModel.initModel();
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
                            await mUser.initModel();
                        }
                    case '0.4.1-beta':
                    case '0.4.2-beta':
                        var mUser = this._shelf.getModel('_user');
                        if (mUser) {
                            var def = mUser.getDefinition();
                            def['attributes'].push({
                                "name": "last_login_at",
                                "dataType": "timestamp"
                            });
                            def['attributes'].push({
                                "name": "last_password_change_at",
                                "dataType": "timestamp"
                            });
                            await this._shelf.upsertModel(mUser.getId(), def);
                            await mUser.initModel();
                        }
                    case '0.4.3-beta':
                    case '0.4.4-beta':
                        var mExt = this._shelf.getModel('_extension');
                        if (mExt) {
                            var def = mExt.getDefinition();
                            var bExist = false;
                            for (var attr of def['attributes']) {
                                if (attr['name'] == 'client-extension') {
                                    bExist = true;
                                    break;
                                }
                            }
                            if (!bExist) {
                                def['attributes'].push({
                                    "name": "client-extension",
                                    "dataType": "text"
                                });
                                await this._shelf.upsertModel(mExt.getId(), def);
                                await mExt.initModel();
                            }
                            await this._shelf.getModel('_model').initModel();
                            await this._shelf.getModel('_user').initModel();
                            var roleModel = this._shelf.getModel('_role');
                            await roleModel.initModel();
                            var rs = await roleModel.readAll({ 'role': 'user' });
                            if (rs && rs.length == 1) {
                                var userRole = rs[0];
                                var permission = {
                                    'model': mExt.getId(),
                                    'role': userRole['id'],
                                    'read': true,
                                    'write': false
                                };
                                var pModel = this._shelf.getModel('_permission');
                                await pModel.initModel();
                                rs = await pModel.readAll(permission);
                                if (!rs || rs.length == 0)
                                    await pModel.create(permission);
                            }
                        }
                        break;
                    case '0.4.5-beta':
                        var def;
                        var model = this._shelf.getModel('_model');
                        if (model) {
                            def = model.getDefinition();
                            if (def['extensions'] && def['extensions']['client'])
                                def['extensions']['client'] = "function init() {\n   this._prepareDataAction = function (data) {\n      if (data['definition'])\n         data['name'] = data['definition']['name'];\n      return data;\n   }\n}\n\nexport { init };";
                            await this._shelf.upsertModel(model.getId(), def);
                            await model.initModel();
                        }
                        model = this._shelf.getModel('_change');
                        if (model) {
                            def = model.getDefinition();
                            if (def['extensions'] && def['extensions']['client'])
                                def['extensions']['client'] = "function init() {\n   this._prepareDataAction = function (data) {\n      var str = \"\";\n      if (data['method'])\n         str += data['method'] + \": \";\n      if (data['model'])\n         str += data['model'];\n      if (data['record_id'])\n         str += \"(\" + data['record_id'] + \")\";\n      data['title'] = str;\n      return data;\n   }\n}\n\nexport { init };";
                            await this._shelf.upsertModel(model.getId(), def);
                            await model.initModel();
                        }
                        model = this._shelf.getModel('_permission');
                        if (model) {
                            def = model.getDefinition();
                            if (def['extensions'] && def['extensions']['client'])
                                def['extensions']['client'] = "function init() {\n   this._prepareDataAction = function (data) {\n      var str = \"\";\n      if (data['user'])\n         str += \"U(\" + data['user']['username'] + \")\";\n      else if (data['role'])\n         str += \"G(\" + data['role']['role'] + \")\";\n      if (data['model'])\n         str += \" - \" + data['model']['definition']['name'] + \" - \";\n      if (data['read'])\n\t str += \"R\";\n      if (data['write'])\n\t str += \"W\";\n      data['title'] = str;\n      return data;\n   }\n}\n\nexport { init };";
                            await this._shelf.upsertModel(model.getId(), def);
                            await model.initModel();
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
                            await this._shelf.upsertModel(undefined, definition);
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