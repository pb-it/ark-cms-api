const v8 = require('v8');
const os = require('os');
const { EOL } = os;
const path = require('path');
const fs = require('fs');

const common = require('../common/common');
const Logger = require('../common/logger/logger');
const ValidationError = require('../common/validation-error');
const VcsEnum = require('../common/vcs-enum');
const AppVersion = require('../common/app-version');
const WebServer = require('./webserver');
const Registry = require('./registry');
const VersionController = require('./version-controller');
const DependencyController = require('./dependency-controller');
const DataTypeController = require('./data-type-controller');
const { ExtensionController } = require('./extension-controller');
const MigrationController = require('./migration-controller');
const { AuthController } = require('./auth-controller');
const WebClientController = require('./webclient-controller');

const Shelf = require('../model/shelf');

class Controller {

    _info;
    _appRoot;
    _vcs;

    _serverConfig;
    _databaseConfig;
    _databaseSettings;

    _bIsRunning;

    _knex;
    _shelf;
    _webserver;

    _logger;
    _registry;
    _tmpDir;

    _versionController;
    _dependencyController;
    _extensionController;
    _migrationsController;
    _authController;
    _webclientController;

    constructor() {
        this._appRoot = path.join(__dirname, "../../"); //ends with backslash(linux)
    }

    async setup(serverConfig, databaseConfig) {
        this._serverConfig = serverConfig;
        this._databaseConfig = databaseConfig;

        //console.log(v8.getHeapStatistics());
        Logger.info("[node] Heap size limit: " + (v8.getHeapStatistics().heap_size_limit / (1024 * 1024))) + " MB";

        this._info = {
            'api': { 'version': 'v1' },
            'state': 'starting'
        };

        this._vcs = await this._checkVcs(this._appRoot);

        if (this._vcs)
            this._info['vcs'] = this._vcs;

        if (this._serverConfig['fileStorage'])
            this._info['cdn'] = this._serverConfig['fileStorage'].map(function (x) { return { 'url': x['url'] } });

        try {
            var defaultConnection = this._databaseConfig['defaultConnection'];
            if (defaultConnection && this._databaseConfig['connections'] && this._databaseConfig['connections'][defaultConnection])
                this._databaseSettings = this._databaseConfig['connections'][defaultConnection]['settings'];
            else
                throw new Error('Faulty database configuration!');
            this._info['db'] = { 'client': this._databaseSettings['client'] };

            this._knex = require('knex')({
                client: this._databaseSettings['client'],
                connection: this._databaseSettings['connection']
            });

            if (this._serverConfig['debug'] && this._serverConfig['debug']['knex']) {
                this._knex.on('query', function (queryData) {
                    console.log(queryData);
                });
            }

            try {
                await this._knex.raw('select 1+1 as result');
                Logger.info("[knex] ✔ Successfully connected to " + this._databaseSettings['client'] + " on " + this._databaseSettings['connection']['host']);
            } catch (error) {
                if (process.env.NODE_ENV !== 'test') {
                    Logger.parseError(error, "[knex] ER_ACCESS_DENIED_ERROR");
                    process.exit(1);
                } else
                    throw error;
            }

            this._logger = new Logger(this._knex);
            await this._logger.initLogger();

            this._shelf = new Shelf(this._knex);
            await this._shelf.initShelf();

            this._registry = new Registry(this._knex);
            await this._registry.initRegistry();

            this._webclientController = new WebClientController();

            this._versionController = new VersionController(this);
            this._info['version'] = this._versionController.getPkgVersion().toString();

            this._dependencyController = new DependencyController(this);
            await this._dependencyController.init();

            this._dataTypeController = new DataTypeController(this);

            this._migrationsController = new MigrationController(this);
            var res = await this._migrationsController.migrateDatabase();
            if (res)
                await this._shelf.initAllModels();

            if (this._serverConfig['auth'] == undefined || this._serverConfig['auth'] == true) {
                this._authController = new AuthController(this);
                await this._authController.initAuthController();
            } else
                this._authController = null;

            this._webserver = new WebServer(this);
            await this._webserver.initServer();

            this._extensionController = new ExtensionController(this);
            await this._extensionController.initExtensionController();

            if (this._info['state'] === 'openRestartRequest')
                ;// this.restart(); // restart request direct after starting possible? how to prevent boot loop
            else if (this._info['state'] === 'starting')
                this._info['state'] = 'running';

            this._bIsRunning = true;

            Logger.info("[App] ✔ Running");
        } catch (error) {
            Logger.parseError(error);
        }
        return Promise.resolve();
    }

    async _checkVcs(appRoot) {
        var vcs;
        if (fs.existsSync(path.join(appRoot, '.svn')))
            vcs = { 'client': VcsEnum.SVN };
        else if (fs.existsSync(path.join(appRoot, '.git'))) {
            vcs = { 'client': VcsEnum.GIT };
            var tag;
            try {
                tag = await common.exec('cd ' + appRoot + ' && git describe --tags --exact-match');
                if (tag) {
                    if (tag.endsWith(EOL))
                        tag = tag.substring(0, tag.length - EOL.length);
                    vcs['tag'] = tag;
                }
            } catch (error) {
                ;//console.log(error);
            }
            if (!tag) {
                try {
                    var revision = await common.exec('cd ' + appRoot + ' && git rev-parse HEAD');
                    if (revision) {
                        if (revision.endsWith(EOL))
                            revision = revision.substring(0, revision.length - EOL.length);
                        vcs['revision'] = revision;
                    }
                } catch (error) {
                    ;//console.log(error);
                }
            }
        }
        return Promise.resolve(vcs);
    }

    getAppRoot() {
        return this._appRoot;
    }

    getInfo() {
        return this._info;
    }

    getServerConfig() {
        return this._serverConfig;
    }

    getDatabaseConfig() {
        return this._databaseConfig;
    }

    getDatabaseSettings() {
        return this._databaseSettings;
    }

    getFileStorage(name) {
        var res;
        if (name) {
            if (this._serverConfig['fileStorage'])
                res = this._serverConfig['fileStorage'].filter(function (x) { return x['name'] === name });
        } else
            res = this._serverConfig['fileStorage'];
        return res;
    }

    getKnex() {
        return this._knex;
    }

    getShelf() {
        return this._shelf;
    }

    getWebServer() {
        return this._webserver;
    }

    getRegistry() {
        return this._registry;
    }

    getWebClientController() {
        return this._webclientController;
    }

    getVersionController() {
        return this._versionController;
    }

    getDependencyController() {
        return this._dependencyController;
    }

    getDataTypeController() {
        return this._dataTypeController;
    }

    getExtensionController() {
        return this._extensionController;
    }

    getMigrationsController() {
        return this._migrationsController;
    }

    getAuthController() {
        return this._authController;
    }

    getState() {
        return this._info['state'];
    }

    getTmpDir() {
        if (!this._tmpDir)
            this._tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-'));
        return this._tmpDir;
    }

    getPathForFile(attr) {
        var localPath;
        if (this._serverConfig['fileStorage']) {
            var p;
            for (var c of this._serverConfig['fileStorage']) {
                if (c['url'] === attr['cdn']) {
                    p = c['path'];
                    break;
                }
            }
            if (p) {
                if (p.startsWith('.'))
                    localPath = path.join(this._appRoot, p);
                else {
                    if (process.platform === 'linux') {
                        if (p.startsWith('/'))
                            localPath = p;
                    } else
                        localPath = p;
                }
            }
        }
        return localPath;
    }

    async update(version, bReset, bRemove) {
        var response;
        Logger.info("[App] Processing update request..");
        if (this._vcs) {
            var updateCmd;
            if (this._vcs['client'] === VcsEnum.GIT) {
                if (bReset)
                    updateCmd = 'git reset --hard && '; //git clean -fxd
                else
                    updateCmd = "";
                if (version) {
                    if (version === 'latest')
                        updateCmd += 'git pull origin main';
                    else
                        updateCmd += 'git switch --detach ' + version;
                } else
                    updateCmd += 'git pull';
            } else if (this._vcs['client'] === VcsEnum.SVN)
                updateCmd = 'svn update';

            if (updateCmd) {
                if (bRemove)
                    updateCmd += " && rm -r node_modules";
                response = await common.exec('cd ' + this._appRoot + ' && ' + updateCmd + ' && npm install --legacy-peer-deps');
            }
        } else
            throw new Error('No version control system detected!');
        return Promise.resolve(response);
    }

    async reload(bForceMigration) {
        var bDone = false;
        this._webserver.deleteAllCustomDataRoutes();
        this._webserver.deleteAllExtensionRoutes();
        await this._extensionController.loadAllExtensions(true);
        Logger.info("[App] Reloading models");
        await this._shelf.loadAllModels();
        if (await this._migrationsController.migrateDatabase(bForceMigration)) {
            await this._shelf.initAllModels();
            bDone = true;
        }
        return Promise.resolve(bDone)
    }

    async shutdown() {
        if (this._webserver)
            await this._webserver.teardown();
        if (this._knex)
            this._knex.destroy();
        this._bIsRunning = false;
        return Promise.resolve();
    }

    isRunning() {
        return this._bIsRunning;
    }

    async restart() {
        Logger.info("[App] Restarting..");
        this._info['state'] = 'restarting';
        if (!this._serverConfig['processManager']) {
            process.on("exit", function () {
                require("child_process").spawn(process.argv.shift(), process.argv, {
                    cwd: process.cwd(),
                    detached: true,
                    stdio: "inherit"
                });
            });
        }
        try {
            await this.shutdown();
        } catch (err) {
            console.log(err);
            if (err)
                Logger.parse(err);
            else
                Logger.error("[App] ✘ An error occurred while shutting down");
        }
        process.exit();
    }

    /**
     * flag to process multiple request at once
     */
    setRestartRequest() {
        Logger.info("[App] Received restart request");
        this._info['state'] = 'openRestartRequest';
        //await controller.restart();
    }

    /**
     * https://stackoverflow.com/questions/630453/what-is-the-difference-between-post-and-put-in-http
     * To satisfy the definition that PUT is idempotent a PUT request must contain an ID.
     * An interpretation of an PUT request without ID would be to replace all data with the new one which won't be supported by now.
     * @param {*} req 
     * @param {*} res 
     * @returns 
     */
    async processRequest(req, res) {
        var bSent = false;

        var name;
        var id;

        var arr = req.params[0].split('/');
        var str = arr.shift();
        if (str === '') {
            name = arr.shift();
            if (name) {
                if (name === '_model' && req.method !== "GET") {
                    if (req.method === "PUT") {
                        id = await this.putModel(req, res);
                        res.json(id);
                        bSent = true;
                        /*if (this._info['state'] === 'openRestartRequest')
                            this.restart(); */ // dont restart in case of importing multiple models at once 
                    } else if (req.method === "DELETE") {
                        str = arr.shift();
                        if (str) {
                            try {
                                id = parseInt(str);
                            } catch (error) {
                                Logger.parseError(error);
                            }
                        }
                        if (id) {
                            var foo;
                            try {
                                foo = await this._shelf.deleteModel(id, req.query['delete_data']);
                            } catch (error) {
                                Logger.parseError(error);
                                throw new ValidationError("Deletion of model failed");
                            }
                            if (foo) {
                                try {
                                    await this._protocol(req, null, req.method, '_model', id, req.body);
                                    Logger.info("[App] ✔ Deleted model '" + foo + "'");
                                    res.send("OK");
                                    bSent = true;
                                } catch (error) {
                                    Logger.parseError(error);
                                    throw new ValidationError("Deletion of model failed");
                                }
                            } else
                                throw new ValidationError("Unexpected behavior while deleting model");
                        } else
                            throw new ValidationError("Invalid model ID");
                    }
                } else if (name === '_extension' && req.method !== "GET") {
                    if (req.method === "POST" || req.method === "PUT") {
                        var data = await this._extensionController.addExtension(req);
                        if (data && data['id']) {
                            id = data['id'];
                            await this._protocol(req, null, req.method, '_extension', id, '-');
                            Logger.info("[App] ✔ Added extension '" + data['name'] + "'");
                            res.json(data);
                            bSent = true;
                        } else
                            throw new ValidationError("Adding extension failed! Please have a look at the server log for further information!");
                    } else if (req.method === "DELETE") {
                        str = arr.shift();
                        if (str) {
                            try {
                                id = parseInt(str);
                            } catch (error) {
                                Logger.parseError(error);
                            }
                        }
                        if (id) {
                            var foo;
                            try {
                                foo = await this._extensionController.deleteExtension(id);
                            } catch (error) {
                                Logger.parseError(error);
                                throw new ValidationError("Deletion of extension failed");
                            }
                            if (foo) {
                                try {
                                    await this._protocol(req, null, req.method, '_extension', id, '-');
                                    Logger.info("[App] ✔ Deleted extension '" + foo + "'");
                                    res.send("OK");
                                    bSent = true;
                                } catch (error) {
                                    Logger.parseError(error);
                                    throw new ValidationError("Deletion of extension failed");
                                }
                            } else
                                throw new ValidationError("Unexpected behavior while deleting extension");
                        } else
                            throw new ValidationError("Invalid extension ID");
                    } else
                        throw new ValidationError("Unsupported method");
                } else {
                    var model = this._shelf.getModel(name);
                    if (model && model.initDone()) {
                        var operation;
                        str = arr.shift();
                        if (str) {
                            if (str === 'count')
                                operation = str;
                            else {
                                try {
                                    id = parseInt(str);
                                } catch (error) {
                                    Logger.parseError(error);
                                }
                                if (!id)
                                    throw new ValidationError("Invalid path");
                            }
                        }
                        var data;
                        var timestamp; // new Date(); req.headers["Date"]; this._knex.fn.now(DEFAULT_TIMESTAMP_PRECISION);
                        switch (req.method) {
                            case "POST":
                                data = await model.create(req.body);
                                id = data['id'];
                                if (data['created_at'])
                                    timestamp = data['created_at'];
                                break;
                            case "GET":
                                data = { 'timestamp': new Date() };
                                if (id)
                                    data['data'] = await model.read(id, req.query);
                                else if (operation === 'count')
                                    data['data'] = await model.count(req.query);
                                else
                                    data['data'] = await model.readAll(req.query);
                                break;
                            case "PUT":
                                data = await model.update(id, req.body);
                                if (data['updated_at'])
                                    timestamp = data['updated_at'];
                                break;
                            case "DELETE":
                                if (model.getDefinition().options.increments)
                                    data = await model.delete(id);
                                else {
                                    if (Object.keys(req.query).length > 0)
                                        data = await model.delete(req.query);
                                    else
                                        data = await model.delete(req.body);
                                }
                                break;
                            default:
                                throw new ValidationError("Unsupported method");
                        }

                        if (req.method !== "GET") {
                            if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
                                var protocol = {};
                                var attribute;
                                var bDelete = (req.method === "DELETE");
                                var tmp;
                                if (bDelete)
                                    tmp = data;
                                else
                                    tmp = req.body;
                                for (var key in tmp) {
                                    if (bDelete || key != 'id') {
                                        attribute = model.getAttribute(key);
                                        if (attribute) {
                                            if (attribute['dataType'] == 'file' && tmp[key] && tmp[key]['base64'])
                                                protocol[key] = tmp[key]['base64'].substring(0, 80) + '...';
                                            else
                                                protocol[key] = tmp[key];
                                        }
                                    }
                                }
                                await this._protocol(req, timestamp, req.method, name, id, protocol);
                            }
                        }

                        if (req.method === "DELETE") {
                            //res.status(204); // 204: No Content
                            res.send("OK");
                        } else if (data)
                            res.json(data);
                        else
                            res.json([]);
                        bSent = true;
                    } else
                        throw new ValidationError("Model '" + name + "' not defined or failed to initiate");
                }
            }
        }
        if (!bSent)
            throw new ValidationError("Invalid path");
        return Promise.resolve();
    }

    async putModel(req) {
        var bDone = false;
        var id;
        var name;
        try {
            if (req.params[0] === '/_model') {
                var version = req.query['v'];
                var bForceMigration = (req.query['forceMigration'] === 'true');
                if (version) {
                    var definition = req.body;
                    var bNew = true;
                    if (definition['id'])
                        bNew = false;
                    name = definition['name'];
                    var appVersion = this._versionController.getPkgVersion();
                    var sAppVersion = appVersion.toString();
                    if (version !== sAppVersion) {
                        var modelVersion = new AppVersion(version);
                        if (MigrationController.compatible(modelVersion, appVersion) || bForceMigration) {
                            definition = MigrationController.updateModelDefinition(definition, modelVersion, appVersion);
                            Logger.info("[MigrationController] ✔ Updated definition of model '" + name + "' to version '" + sAppVersion + "'");
                        } else
                            throw new ValidationError("An update of the major or minor release version may result in faulty models! Force only after studying changelog!");
                    }
                    var model = await this._shelf.upsertModel(undefined, definition);
                    await model.initModel();
                    id = model.getId();
                    var user;
                    if (this._authController && req.session)
                        user = req.session.user;
                    var uid;
                    if (user)
                        uid = user['id'];
                    else
                        uid = null;
                    await this._protocol(req, null, req.method, '_model', id, req.body, uid);
                    if (bNew && user && user.username !== 'admin') {
                        var permission = {
                            'user': uid,
                            'model': id,
                            'read': true,
                            'write': true
                        };
                        model = this._shelf.getModel('_permission');
                        var data = await model.create(permission);
                        if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
                            var pid = data['id'];
                            var timestamp = data['created_at'];
                            await this._protocol(req, timestamp, 'POST', '_permission', pid, permission, uid);
                        }
                    }
                    Logger.info("[App] ✔ Creation or replacement of model '" + name + "' successful");
                    bDone = true;
                } else
                    throw new ValidationError("Please specify model version");
            } else {
                if (req.params[0].startsWith('/_model/')) {
                    var arr = req.params[0].substring('/_model/'.length).split('/');
                    var str = arr.shift();
                    try {
                        id = parseInt(str);
                    } catch (error) {
                        Logger.parseError(error);
                    }
                    if (id) {
                        var models = this._shelf.getModel();
                        var model;
                        for (var m of models) {
                            if (m.getId() == id) {
                                model = m;
                                break;
                            }
                        }
                        if (model) {
                            name = model.getName();
                            str = arr.shift();
                            if (str) {
                                var definition;
                                if (str === 'states') {
                                    definition = model.getDefinition();
                                    definition['states'] = req.body;
                                } else if (str === 'filters') {
                                    definition = model.getDefinition();
                                    definition['filters'] = req.body;
                                } else if (str === 'defaults') {
                                    str = arr.shift();
                                    if (str === "view") {
                                        definition = model.getDefinition();
                                        var defaults = definition['defaults'];
                                        if (!defaults) {
                                            defaults = {};
                                            definition['defaults'] = defaults;
                                        }
                                        defaults['view'] = req.body;
                                    } else if (str === "sort") {
                                        definition = model.getDefinition();
                                        var defaults = definition['defaults'];
                                        if (!defaults) {
                                            defaults = {};
                                            definition['defaults'] = defaults;
                                        }
                                        defaults['sort'] = req.body['sort'];
                                    }
                                }
                                if (definition) {
                                    model = await this._shelf.upsertModel(id, definition);
                                    if (definition['attributes'])
                                        await model.initModel();
                                    await this._protocol(req, null, req.method, '_model', id, req.body);
                                    Logger.info("[App] ✔ Updated model '" + name + "'");
                                    bDone = true;
                                }
                            }
                        } else
                            throw new ValidationError("Invalid model ID");
                    } else
                        throw new ValidationError("Invalid model ID");
                }
            }
        } catch (error) {
            Logger.parseError(error);
            var msg = "Creation or replacement of model";
            if (name)
                msg += " '" + name + "'";
            else if (id)
                msg += " [id:" + id + "]";
            msg += " failed";
            throw new ValidationError(msg);
        }
        if (!bDone || !id)
            throw new ValidationError("Invalid path");
        return Promise.resolve(id);
    }

    async _protocol(req, timestamp, method, model, id, data, uid) {
        if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
            if (!method && req)
                method = req.method;
            if (!timestamp) {
                if (id && method != 'DELETE' && (model == '_model' || model == '_extension')) {
                    var x = await this._shelf.getModel(model).read(id);
                    timestamp = x['updated_at'];
                } else
                    timestamp = null;
            }
            if (this._authController && !uid && req && req.session) {
                var user = req.session.user;
                if (user)
                    uid = user['id'];
                else
                    uid = null;
            }
            var change = {
                'method': method,
                'model': model,
                'record_id': id,
                'data': JSON.stringify(data)
            };
            if (this._authController)
                change['user'] = uid;
            if (timestamp)
                change['timestamp'] = timestamp;
            await this._shelf.getModel('_change').create(change);
        }
        return Promise.resolve();
    }
}

module.exports = Controller;