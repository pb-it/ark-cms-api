const v8 = require('v8');
const os = require('os');
const path = require('path');
const fs = require('fs');

const common = require('../common/common');
const Logger = require('../common/logger/logger');
const ValidationError = require('../common/validation-error');
const VcsEnum = require('../common/vcs-enum');
const WebClient = require('../common/webclient');
const AppVersion = require('../common/app-version');
const WebServer = require('./webserver');
const Registry = require('./registry');
const VersionController = require('./version-controller');
const DependencyController = require('./dependency-controller');
const ExtensionController = require('./extension-controller');
const MigrationController = require('./migration-controller');
const AuthController = require('./auth-controller');

const Shelf = require('../model/shelf');

function createDateTimeString() {
    const date = new Date(); //new Date().toUTCString(); //new Date().toLocaleTimeString()
    const seconds = `${date.getSeconds()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${hours}-${minutes}-${seconds}_${day}-${month}-${year}`;
}

class Controller {

    _info;
    _appRoot;
    _vcs;

    _serverConfig;
    _databaseConfig;
    _databaseSettings;
    _cdnConfig;

    _bIsRunning;

    _knex;
    _shelf;
    _webserver;

    _logger;
    _registry;
    _webclient;
    _tmpDir;

    _versionController;
    _dependencyController;
    _extensionController;
    _migrationsController;
    _authController;

    constructor() {
        this._appRoot = path.join(__dirname, "../../"); //ends with backslash(linux)
    }

    async setup(serverConfig, databaseConfig) {
        this._serverConfig = serverConfig;
        this._databaseConfig = databaseConfig;

        //console.log(v8.getHeapStatistics());
        Logger.info("[node] Heap size limit: " + (v8.getHeapStatistics().heap_size_limit / (1024 * 1024))) + " MB";

        this._info = {
            'state': 'starting'
        };

        if (fs.existsSync(path.join(this._appRoot, '.git')))
            this._vcs = VcsEnum.GIT;
        else if (fs.existsSync(path.join(this._appRoot, '.svn')))
            this._vcs = VcsEnum.SVN;

        if (this._vcs)
            this._info['vcs'] = this._vcs;

        var file = path.join(this._appRoot, './config/cdn-config.js');
        if (fs.existsSync(file)) {
            this._cdnConfig = require(file);
            this._info['cdn'] = this._cdnConfig.map(function (x) { return { 'url': x['url'] } });
        }

        try {
            var defaultConnection = this._databaseConfig['defaultConnection'];
            if (defaultConnection && this._databaseConfig['connections'] && this._databaseConfig['connections'][defaultConnection])
                this._databaseSettings = this._databaseConfig['connections'][defaultConnection]['settings'];
            else
                throw new Error('Faulty database configuration!');
            this._info['db_client'] = this._databaseSettings['client'];

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
                Logger.parseError(error, "[knex]");
                process.exit(1);
            }

            this._logger = new Logger(this._knex);
            await this._logger.initLogger();

            this._webserver = new WebServer(this);
            await this._webserver.initServer();

            this._shelf = new Shelf(this._knex);
            await this._shelf.initShelf();

            this._registry = new Registry(this._knex);
            await this._registry.initRegistry();

            this._webclient = new WebClient();

            this._versionController = new VersionController(this);
            this._info['version'] = this._versionController.getVersion().toString();

            this._dependencyController = new DependencyController(this);
            await this._dependencyController.init();

            this._extensionController = new ExtensionController(this);
            await this._extensionController.initExtensionController();

            this._migrationsController = new MigrationController(this);
            var res = await this._migrationsController.migrateDatabase();
            if (res)
                await this._shelf.initAllModels();

            this._authController = new AuthController(this);
            await this._authController.initAuthController();

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

    getAppRoot() {
        return this._appRoot;
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

    getCdnConfig() {
        return this._cdnConfig;
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

    getWebClient() {
        return this._webclient;
    }

    getVersionController() {
        return this._versionController;
    }

    getDependencyController() {
        return this._dependencyController;
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

    getTmpDir() {
        if (!this._tmpDir)
            this._tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-'));
        return this._tmpDir;
    }

    getPathForFile(attr) {
        var localPath;
        if (this._cdnConfig) {
            var p;
            for (var c of this._cdnConfig) {
                if (c['url'] === attr['cdn']) {
                    p = c['path'];
                    break;
                }
            }
            if (p) {
                if (p.startsWith('.'))
                    localPath = path.join(controller.getAppRoot(), p);
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

    async update(version, bForce) {
        var response;
        Logger.info("[App] Processing update request..");
        if (this._vcs) {
            var updateCmd;
            if (this._vcs === VcsEnum.GIT) {
                if (bForce)
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
            } else if (this._vcs === VcsEnum.SVN)
                updateCmd = 'svn update';

            if (updateCmd) {
                if (bForce)
                    updateCmd += " && rm -r node_modules";
                response = await common.exec('cd ' + this._appRoot + ' && ' + updateCmd + ' && npm install --legacy-peer-deps');
            }
        } else
            throw new Error('No version control system detected');
        return Promise.resolve(response);
    }

    async teardown() {
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
            await this.teardown();
        } catch (err) {
            console.log(err);
            Logger.error("[App] ✘ An error occurred while shutting down");
        }
        process.exit();
    }

    /**
     * flag to process multiple request at once
     */
    setRestartRequest() {
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
        var rel;

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
                                foo = await this._shelf.deleteModel(id);
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
                        if (data) {
                            id = data['id'];
                            await this._protocol(req, null, req.method, '_extension', id, '-');
                            Logger.info("[App] ✔ Added extension '" + data['name'] + "'");
                            res.json(data);
                            bSent = true;
                        } else
                            throw new ValidationError("Adding extension failed");
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
                        throw new ValidationError("Unsuppourted method");
                } else {
                    var model = this._shelf.getModel(name);
                    if (model) {
                        str = arr.shift();
                        if (str) {
                            try {
                                id = parseInt(str);
                            } catch (error) {
                                Logger.parseError(error);
                            }
                            if (!id)
                                throw new ValidationError("Invalid path");
                        }
                        var data;
                        var timestamp;
                        switch (req.method) {
                            case "POST":
                                data = await model.create(req.body);
                                id = data['id'];
                                timestamp = data['created_at'];
                                break;
                            case "GET":
                                if (rel)
                                    data = await model.readRel({ 'id': id }, rel);
                                else if (id)
                                    data = await model.read(id);
                                else
                                    data = await model.readAll(req.query);
                                break;
                            case "PUT":
                                data = await model.update(id, req.body);
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
                                timestamp = this._knex.fn.now();
                                break;
                            default:
                                throw new ValidationError("Unsuppourted method");
                        }

                        if (timestamp) { //req.method !== "GET"
                            if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
                                var protocol = {};
                                var attribute;
                                for (var key in req.body) {
                                    if (key != 'id') {
                                        attribute = model.getAttribute(key);
                                        if (attribute) {
                                            if (attribute['dataType'] == 'file' && req.body[key]['base64'])
                                                protocol[key] = req.body[key]['base64'].substring(0, 80) + '...';
                                            else
                                                protocol[key] = req.body[key];
                                        }
                                    }
                                }
                                await this._protocol(req, timestamp, req.method, name, id, protocol);
                            }
                        }

                        if (req.method === "DELETE")
                            res.send("OK");
                        else if (data)
                            res.json(data);
                        else
                            res.json([]);
                        bSent = true;
                    } else
                        throw new ValidationError("Model '" + name + "' not defined");
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
        if (req.params[0] === '/_model') {
            var version = req.query['v'];
            var bForceMigration = (req.query['forceMigration'] === 'true');
            if (version) {
                var definition = req.body;
                var bNew = true;
                if (definition['id'])
                    bNew = false;
                var name = definition['name'];
                var appVersion = this._versionController.getVersion();
                var sAppVersion = appVersion.toString();
                if (version !== sAppVersion) {
                    var modelVersion = new AppVersion(version);
                    if (MigrationController.compatible(modelVersion, appVersion) || bForceMigration) {
                        definition = MigrationController.updateModelDefinition(definition, modelVersion, appVersion);
                        Logger.info("[MigrationController] ✔ Updated definition of model '" + name + "' to version '" + sAppVersion + "'");
                    } else {
                        if (modelVersion.major > appVersion.major || modelVersion.minor > appVersion.minor || modelVersion.patch > appVersion.patch)
                            throw new ValidationError("Model version newer than application version! Force only after studying changelog!");
                        else
                            throw new ValidationError("An update of the minor release version may result in faulty models! Force only after studying changelog!");
                    }
                }
                var model = await this._shelf.upsertModel(undefined, definition);
                await model.initModel();
                id = model.getId();
                var user = req.session.user;
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
                    var models = this._shelf.getModels();
                    var model;
                    for (var m of models) {
                        if (m.getId() == id) {
                            model = m;
                            break;
                        }
                    }
                    if (model) {
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
                                try {
                                    model = await this._shelf.upsertModel(id, definition);
                                    if (definition['attributes'])
                                        await model.initModel();
                                    await this._protocol(req, null, req.method, '_model', id, req.body);
                                    Logger.info("[App] ✔ Updated model '" + model.getName() + "'");
                                    bDone = true;
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
                            }
                        }
                    } else
                        throw new ValidationError("Invalid model ID");
                } else
                    throw new ValidationError("Invalid model ID");
            }
        }
        if (!bDone || !id)
            throw new ValidationError("Invalid path");
        return Promise.resolve(id);
    }

    async _protocol(req, timestamp, method, model, id, data, uid) {
        if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
            if (!method)
                method = req.method;
            if (!timestamp) {
                if (method != 'DELETE' && (model == '_model' || model == '_extension')) {
                    var x = await this._shelf.getModel(model).read(id);
                    timestamp = x['updated_at'];
                } else
                    timestamp = null;
            }
            if (!uid) {
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
                'data': JSON.stringify(data),
                'user': uid
            };
            if (timestamp)
                change['timestamp'] = timestamp;
            await this._shelf.getModel('_change').create(change);
        }
        return Promise.resolve();
    }
}

module.exports = new Controller();