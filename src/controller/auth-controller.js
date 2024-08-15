const crypto = require('crypto');
const bcrypt = require('bcrypt');

const Logger = require('../common/logger/logger');

class AuthError extends Error {
    constructor(message) {
        super(message);
        this.name = "AuthError";
    }
}

class AuthController {

    static createPasswordEntry(password) {
        var salt = bcrypt.genSaltSync(10);
        var hash = AuthController.hashPassword(password, salt);
        return `${salt}:${hash}`;
    }

    static hashPassword(password, salt) {
        var hash;
        if (salt)
            hash = bcrypt.hashSync(password, salt);
        else
            hash = crypto.createHash('sha256').update(password).digest('base64');
        return hash;
    }

    _controller;
    _userModel;
    _roleModel;
    _permissionModel;

    _userRole;

    constructor(controller) {
        this._controller = controller;
    }

    async initAuthController() {
        var shelf = this._controller.getShelf();
        var bCreatePermissions = false;

        this._userModel = shelf.getModel('_user');
        if (!this._userModel) {
            var definition = {
                "name": "_user",
                "options": {
                    "increments": true,
                    "timestamps": true
                },
                "attributes": [
                    {
                        "name": "email",
                        "dataType": "string",
                        "length": 320,
                        "required": true,
                        "unique": true
                    },
                    {
                        "name": "username",
                        "dataType": "string",
                        "length": 63,
                        "required": true,
                        "unique": true
                    },
                    {
                        "name": "password",
                        "dataType": "string",
                        "length": 96,
                        "required": true
                    },
                    {
                        "name": "roles",
                        "dataType": "relation",
                        "model": "_role",
                        "multiple": true
                    },
                    {
                        'name': 'last_login_at',
                        'dataType': 'timestamp'
                    },
                    {
                        "name": "last_password_change_at",
                        "dataType": "timestamp"
                    }
                ],
                "defaults": {
                    "title": "username",
                    "view": {
                        "details": "title"
                    }
                }
            }
            this._userModel = await shelf.upsertModel(null, definition);
        }
        this._userModel.setPreCreateHook(async function (data) {
            if (data['password'])
                data['password'] = AuthController.createPasswordEntry(data['password']);
            return Promise.resolve(data);
        });
        this._userModel.setPostCreateHook(async function (data) {
            if (data['password'])
                data['password'] = '******';
            return Promise.resolve(data);
        });
        this._userModel.setPreUpdateHook(async function (current, data) {
            if (data['password'])
                data['password'] = AuthController.createPasswordEntry(data['password']);
            return Promise.resolve(data);
        });
        this._userModel.setPostUpdateHook(async function (data) {
            if (data['password'])
                data['password'] = '******';
            return Promise.resolve(data);
        });
        this._userModel.setPostReadHook(async function (data) {
            if (data['password'])
                data['password'] = '******';
            return Promise.resolve(data);
        });
        if (!this._userModel.initDone())
            await this._userModel.initModel();

        this._roleModel = shelf.getModel('_role');
        if (!this._roleModel) {
            var definition = {
                "name": "_role",
                "options": {
                    "increments": true,
                    "timestamps": true
                },
                "attributes": [
                    {
                        "name": "role",
                        "dataType": "string",
                        "length": 63,
                        "required": true,
                        "unique": true
                    },
                    {
                        "name": "users",
                        "dataType": "relation",
                        "model": "_user",
                        "multiple": true
                    }
                ],
                "defaults": {
                    "title": "role",
                    "view": {
                        "details": "title"
                    }
                }
            }
            this._roleModel = await shelf.upsertModel(null, definition);
        }
        if (!this._roleModel.initDone())
            await this._roleModel.initModel();

        this._permissionModel = shelf.getModel('_permission');
        if (!this._permissionModel) {
            var definition = {
                "name": "_permission",
                "options": {
                    "increments": true,
                    "timestamps": true
                },
                "attributes": [
                    {
                        "name": "model",
                        "dataType": "relation",
                        "model": "_model"
                    },
                    {
                        "name": "role",
                        "dataType": "relation",
                        "model": "_role"
                    },
                    {
                        "name": "user",
                        "dataType": "relation",
                        "model": "_user"
                    },
                    {
                        "name": "read",
                        "dataType": "boolean",
                        "required": true,
                        "defaultValue": false
                    },
                    {
                        "name": "write",
                        "dataType": "boolean",
                        "required": true,
                        "defaultValue": false
                    },
                    {
                        "name": "title",
                        "dataType": "string",
                        "persistent": false,
                        "hidden": true
                    }
                ],
                "defaults": {
                    "title": "title",
                    "view": {
                        "details": "title"
                    }
                },
                "_sys": {
                    "modules": {
                        "client": "function init() {\n   this._prepareDataAction = function (data) {\n      var str = \"\";\n      if (data['user'])\n         str += \"U(\" + data['user']['username'] + \")\";\n      else if (data['role'])\n         str += \"G(\" + data['role']['role'] + \")\";\n      if (data['model'])\n         str += \" - \" + data['model']['definition']['name'] + \" - \";\n      if (data['read'])\n\t str += \"R\";\n      if (data['write'])\n\t str += \"W\";\n      data['title'] = str;\n      return data;\n   }\n}\n\nexport { init };"
                    }
                }
            }
            this._permissionModel = await shelf.upsertModel(null, definition);
            bCreatePermissions = true;
        }
        if (!this._permissionModel.initDone())
            await this._permissionModel.initModel();

        var adminUser;
        var res = await this._userModel.readAll({ 'username': 'admin' });
        if (res && res.length == 1)
            adminUser = res[0];
        else
            adminUser = await this._userModel.create({ 'username': 'admin', 'password': 'admin', 'email': 'admin@cms.local' });

        res = await this._roleModel.readAll({ 'role': 'administrator' });
        if (res && res.length == 0)
            await this._roleModel.create({ 'role': 'administrator', 'users': [adminUser['id']] });
        res = await this._roleModel.readAll({ 'role': 'user' });
        if (res && res.length == 1)
            this._userRole = res[0];
        else
            this._userRole = await this._roleModel.create({ 'role': 'user' });

        if (bCreatePermissions) {
            const permission = {
                'role': this._userRole['id'],
                'read': true,
                'write': false
            };

            permission['model'] = shelf.getModel('_model').getId();
            await this._permissionModel.create(permission);

            permission['model'] = shelf.getModel('_registry').getId();
            await this._permissionModel.create(permission);

            permission['model'] = shelf.getModel('_change').getId();
            await this._permissionModel.create(permission);

            permission['model'] = shelf.getModel('_user').getId();
            await this._permissionModel.create(permission);

            permission['model'] = shelf.getModel('_role').getId();
            await this._permissionModel.create(permission);

            const model = shelf.getModel('_extensions');
            if (model) {
                permission['model'] = model.getId();
                await this._permissionModel.create(permission);
            }
        }

        var mChange = shelf.getModel('_change');
        var definition = mChange.getDefinition();
        var bFound;
        for (var attr of definition['attributes']) {
            if (attr['name'] === 'user') {
                bFound = true;
                break;
            }
        }
        if (!bFound) {
            definition['attributes'].push({
                "name": "user",
                "dataType": "relation",
                "model": "_user"
            });
            mChange = await shelf.upsertModel(mChange.getId(), definition);
            await mChange.initModel(true);
        }

        return Promise.resolve();
    }

    async addDefaultPermission(model) {
        const permission = {
            'model': model.getId(),
            'role': this._userRole['id'],
            'read': true,
            'write': false
        };
        await this._permissionModel.create(permission);
        return Promise.resolve();
    }

    async checkAuthentication(username, password) {
        var user;
        try {
            var res = await this._userModel.readAll({ 'username': username }, false);
            if (res && res.length == 1) {
                var parts = res[0]['password'].split(':');
                var salt;
                var hash;
                if (parts.length == 1)
                    hash = parts[0];
                else if (parts.length == 2) {
                    salt = parts[0];
                    hash = parts[1];
                }
                if (hash == AuthController.hashPassword(password, salt)) {
                    var id = res[0]['id'];
                    user = { 'username': username };
                    user['id'] = id;
                    user['roles'] = res[0]['roles'].map(function (x) { return x['role'] });
                    await this._userModel.update(id, { 'last_login_at': this._controller.getKnex().fn.now(DEFAULT_TIMESTAMP_PRECISION) });
                }
            }
        } catch (error) {
            Logger.parseError(error);
        }
        return Promise.resolve(user);
    }

    async hasPermission(user, model, action) {
        var bPermission = false;
        var permissions;
        if (action === 1)
            permissions = await this._permissionModel.readAll({ 'model': model.getId(), 'read': true });
        else
            permissions = await this._permissionModel.readAll({ 'model': model.getId(), 'write': true });
        if (permissions && permissions.length > 0) {
            for (var permission of permissions) {
                if (permission['user']) {
                    if (user['username'] == permission['user']['username']) {
                        bPermission = true;
                        break;
                    }
                } else if (permission['role']) {
                    if (user['roles'].includes(permission['role']['role'])) {
                        bPermission = true;
                        break;
                    }
                }
            }
        }
        return Promise.resolve(bPermission);
    }

    async changePassword(user, current_password, new_password) {
        var bDone = false;
        user = await this.checkAuthentication(user, current_password);
        if (user && user['id']) {
            await this._userModel.update(user['id'], { 'password': new_password, 'last_password_change_at': this._controller.getKnex().fn.now(DEFAULT_TIMESTAMP_PRECISION) });
            bDone = true;
        } else
            throw new AuthError('Invalid Credentials!');
        return Promise.resolve(bDone);
    }
}

module.exports = { AuthController, AuthError };