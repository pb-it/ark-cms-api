const crypto = require('crypto');

class AuthController {

    _userModel;
    _roleModel;
    _permissionModel;

    constructor() {
    }

    async initAuthController() {
        var shelf = controller.getShelf();
        var bCreateAdminUser = false;
        var bCreateRoles = false;
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
                        "length": 44,
                        "required": true
                    },
                    {
                        "name": "roles",
                        "dataType": "relation",
                        "model": "_role",
                        "multiple": true
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
            bCreateAdminUser = true;
        }

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
            bCreateRoles = true;
        }

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
                "extensions": {
                    "client": "this._prepareDataAction = function (data) {\n    var str = \"\";\n    if (data['user'])\n        str += \"U(\" + data['user']['username'] + \")\";\n    else if (data['role'])\n        str += \"G(\" + data['role']['role'] + \")\";\n    if (data['model'])\n        str += \" - \" + data['model']['definition']['name'] + \" - \";\n    if (data['read'])\n\tstr += \"R\";\n    if (data['write'])\n\tstr += \"W\";\n    data['title'] = str;\n    return data;\n}"
                }
            }
            this._permissionModel = await shelf.upsertModel(null, definition);
            bCreatePermissions = true;
        }

        var adminUser;
        if (bCreateAdminUser)
            adminUser = await this._userModel.create({ 'username': 'admin', 'password': this._hashPassword('admin'), 'email': 'admin@cms.local' });

        var adminRole;
        var userRole;
        if (bCreateRoles) {
            if (!adminUser) {
                var res = await this._userModel.readAll({ 'username': 'admin' });
                if (res && res.length == 1)
                    adminUser = res[0];
            }
            if (adminUser)
                adminRole = await this._roleModel.create({ 'role': 'administrator', 'users': [adminUser['id']] });
            else
                throw new Error("Admin user missing");

            userRole = await this._roleModel.create({ 'role': 'user' });
        }

        if (bCreatePermissions) {
            if (!userRole) {
                var res = await this._roleModel.readAll({ 'role': 'user' });
                if (res && res.length == 1)
                    userRole = res[0];
            }
            if (userRole) {
                var permission = {
                    'role': userRole['id'],
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
            } else
                throw new Error("Admin role missing");
        }

        return Promise.resolve();
    }

    async checkAuthentication(username, password) {
        var user;
        var res = await this._userModel.readAll({ 'username': username });
        if (res && res.length == 1) {
            if (res[0]['password'] == this._hashPassword(password)) {
                user = { 'username': username };
                user['id'] = res[0]['id'];
                user['roles'] = res[0]['roles'].map(function (x) { return x['role'] });
            }
        }
        return user;
    }

    _hashPassword(password) {
        return crypto.createHash('sha256').update(password).digest('base64'); //digest('hex')
    }

    async checkAuthorization(req, res, next) {
        if (true) {
            if (req.originalUrl == "/") {
                if (req.session.user)
                    next();
                else
                    res.redirect('/login');
            } else if (req.originalUrl == "/login" || req.originalUrl == "/logout")
                next();
            else {
                if (req.session.user) {
                    var bAllow = false;
                    if (req.session.user.roles.includes('administrator'))
                        bAllow = true;
                    else if (req.path == '/system/info')
                        bAllow = true;
                    else if (req.originalUrl.startsWith('/api/')) {
                        var arr = req.path.split('/');
                        if (arr.length >= 3) {
                            var modelName = arr[2];
                            var model = controller.getShelf().getModel(modelName);
                            if (model) {
                                var permissions;
                                if (req.method === 'GET')
                                    permissions = await this._permissionModel.readAll({ 'model': model.getId(), 'read': true });
                                else
                                    permissions = await this._permissionModel.readAll({ 'model': model.getId(), 'write': true });
                                if (permissions && permissions.length > 0) {
                                    for (var permission of permissions) {
                                        if (permission['user']) {
                                            if (req.session.user.username == permission['user']['username']) {
                                                bAllow = true;
                                                break;
                                            }
                                        } else if (permission['role']) {
                                            if (req.session.user.roles.includes(permission['role']['role'])) {
                                                bAllow = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (bAllow)
                        next();
                    else
                        res.sendStatus(403); //Forbidden //TODO:
                } else
                    res.sendStatus(401); //Unauthorized
            }
        } else
            next();
        return Promise.resolve();
    }
}

module.exports = AuthController;