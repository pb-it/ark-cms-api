const os = require('os');
const path = require('path');
const fs = require('fs');

const Logger = require('../common/logger/logger');
const SeverityEnum = require('../common/logger/severity-enum');
const common = require('../common/common');
const Registry = require('./registry');
const MigrationController = require('./migration-controller');
const VersionController = require('./version-controller');
const AppVersion = require('../common/app-version');
const Shelf = require('../model/shelf');

const VcsEnum = Object.freeze({ GIT: 'git', SVN: 'svn' });

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}

class Controller {

    _info;
    _appRoot;
    _vcs;

    _serverConfig;
    _databaseConfig;
    _cdnConfig;

    _bIsRunning;

    _knex;
    _svr;

    _logger;
    _registry;

    _migrationsController;
    _versionController;

    _profileController;
    _shelf;

    _routes;

    constructor() {
        this._appRoot = path.join(__dirname, "../../"); //ends with backslash(linux)
    }

    async setup(serverConfig, databaseConfig) {
        this._serverConfig = serverConfig;
        this._databaseConfig = databaseConfig;

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

        this._routes = [];

        try {
            var defaultConnection = this._databaseConfig['defaultConnection'];
            var databaseSettings;
            if (defaultConnection && this._databaseConfig['connections'] && this._databaseConfig['connections'][defaultConnection])
                databaseSettings = this._databaseConfig['connections'][defaultConnection]['settings'];
            else
                throw new Error('Faulty database configuration!');
            this._info['db_client'] = databaseSettings['client'];

            this._knex = require('knex')({
                client: databaseSettings['client'],
                connection: databaseSettings['connection']
            });
            /*this._knex.on('query', function (queryData) {
                console.log(queryData);
            });*/

            try {
                await this._knex.raw('select 1+1 as result');
                Logger.info("[knex] ✔ Successfully connected to " + databaseSettings['client'] + " on " + databaseSettings['connection']['host']);
            } catch (error) {
                Logger.parseError(error, "[knex]");
                process.exit(1);
            }

            this._logger = new Logger(this._knex);
            await this._logger.initLogger();

            this._shelf = new Shelf(this._knex);
            await this._shelf.initShelf();

            this._registry = new Registry(this._knex);
            await this._registry.initRegistry();

            this._versionController = new VersionController(this);
            this._info['version'] = this._versionController.getVersion().toString();
            this._migrationsController = new MigrationController(this);

            var res = await this._migrationsController.migrateDatabase();
            if (res)
                await this._shelf.initAllModels();

            if (this._info['state'] === 'openRestartRequest')
                ;// this.restart(); // restart request direct after starting possible? how to prevent boot loop
            else if (this._info['state'] === 'starting')
                this._info['state'] = 'running';

            this._startExpress();
            this._bIsRunning = true;
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

    getCdnConfig() {
        return this._cdnConfig;
    }

    getKnex() {
        return this._knex;
    }

    getRegistry() {
        return this._registry;
    }

    getMigrationsController() {
        return this._migrationsController;
    }

    getVersionController() {
        return this._versionController;
    }

    getShelf() {
        return this._shelf;
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
                    updateCmd += " rm -r node_modules";
                response = await common.exec('cd ' + this._appRoot + ' && ' + updateCmd + ' && npm install --legacy-peer-deps');
            }
        } else
            throw new Error('No version control system detected');
        return Promise.resolve(response);
    }

    teardown() {
        if (this._svr)
            this._svr.close();
        if (this._knex)
            this._knex.destroy();
        this._bIsRunning = false;
    }

    isRunning() {
        return this._bIsRunning;
    }

    restart() {
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
        this.teardown();
        process.exit();
    }

    addRoute(route) {
        if (route['regex'] && route['fn']) {
            this.deleteRoute(route);
            this._routes.push(route);
        }
    }

    deleteRoute(route) {
        if (route['regex']) {
            this._routes = this._routes.filter(function (x) {
                x['regex'] !== route['regex'];
            });
        }
    }

    async installDependencies(arr) {
        var file = path.join(this._appRoot, 'package.json');
        var str = fs.readFileSync(file, 'utf8');
        var pkg = JSON.parse(str);
        var installed = Object.keys(pkg['dependencies']);
        var missing = [];
        var split;
        var name;
        var version;
        for (var x of arr) {
            name = null;
            version = null;
            split = x.split('@');
            if (split.length == 1)
                name = split[0];
            else {
                if (split[0] === '') {
                    name = '@' + split[1]; // @ at the first position indicates submodules
                    if (split.length == 3)
                        version = split[2];
                } else {
                    name = split[0];
                    version = split[1];
                }
            }
            if (version && version.startsWith('https://github.com/'))
                version = 'github:' + version.substring('https://github.com/'.length);
            if (!installed.includes(name) || (version && version !== pkg['dependencies'][name]))
                missing.push({ 'ident': x, 'name': name, 'version': version })
        }

        if (missing.length > 0) {
            var idents = missing.map(function (x) { return x['ident'] });
            Logger.info('[App] Installing missing dependencies \'' + idents.join('\', \'') + '\'');
            var dir;
            for (var x of missing) {
                dir = path.join(this._appRoot, x['name']);
                if (fs.existsSync(dir))
                    fs.rmSync(dir, { recursive: true, force: true });
            }
            await common.exec('cd ' + this._appRoot + ' && npm install ' + idents.join(' ') + ' --legacy-peer-deps');
            this.setRestartRequest();
        }
        return Promise.resolve();
    }

    /**
     * add-dependencies only adds the dependency to package.json without installing it
     * still has to fork npm processes for version checks which are quite time-consuming
     */
    async installWithAddDependencies() {
        var bInstall = true;
        //var res = await exec('npm list --location=global add-dependencies');
        var json = await common.exec('npm list --location=global -json'); // --silent --legacy-peer-deps
        var obj = JSON.parse(json);
        if (obj && obj['dependencies'] && obj['dependencies']['add-dependencies'])
            bInstall = false;
        if (bInstall) {
            Logger.info('Installing \'add-dependencies\' ...');
            await common.exec('npm install add-dependencies --location=global');
        } else
            Logger.info('\'add-dependencies\' already installed');

        var file = path.join(this._appRoot, 'package.json');
        var before = fs.readFileSync(file, 'utf8');
        await common.exec('add-dependencies ' + file + ' ' + arr.join(' ') + ' --no-overwrite');
        var after = fs.readFileSync(file, 'utf8');
        if (before !== after) {
            Logger.info('[App] Installing new dependencies');
            await common.exec('cd ' + this._appRoot + ' && npm install --legacy-peer-deps');
            this.setRestartRequest();
        }
        return Promise.resolve();
    }

    /**
     * flag to process multiple request at once
     */
    setRestartRequest() {
        this._info['state'] = 'openRestartRequest';
        //await controller.restart();
    }

    _startExpress() {
        var express = require('express');
        var cors = require('cors')
        var bodyParser = require('body-parser');

        var app = express();
        app.use(cors());
        app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
        app.use(bodyParser.json({ limit: '100mb' }));

        app.get('/robots.txt', function (req, res) {
            res.type('text/plain');
            res.send("User-agent: *\nDisallow: /");
        });
        //app.use('/robots.txt', express.static('robots.txt'));

        var systemRouter = express.Router();
        systemRouter.get('/info', function (req, res) {
            res.json(this._info);
        }.bind(this));
        systemRouter.get('/log', function (req, res) {
            var severity = req.query['severity'];
            var format = req.query['_format'];
            var sort = req.query['_sort'];
            var entries;
            try {
                entries = Logger.getAllEntries(sort);
                if (severity) {
                    var s;
                    switch (severity) {
                        case 'info':
                            s = SeverityEnum.INFO;
                            break;
                        case 'warning':
                            s = SeverityEnum.WARNING;
                            break;
                        case 'error':
                            s = SeverityEnum.ERROR;
                            break;
                        default:
                    }

                    if (s) {
                        entries = entries.filter(function (x) {
                            return x['severity'] === s;
                        });
                    } else
                        throw new Error('Parsing severity failed');
                }

                if (format && format === 'json')
                    res.json(entries);
                else {
                    var list = "";
                    for (var entry of entries) {
                        if (list.length > 0)
                            list += '\r\n';
                        list += entry.toString();
                    }
                    res.type('text/plain');
                    res.send(list);
                }
            } catch (error) {
                Logger.parseError(error);
                res.status(500);
                res.send("Parsing log file failed");
            }
        });
        systemRouter.get('/update', async function (req, res) {
            var version = req.query['v'];
            var bForce = req.query['force'] && (req.query['force'] === 'true');
            var msg;
            var bUpdated = false;
            try {
                msg = await this.update(version, bForce);
                console.log(msg);
                var strUpToDate;
                if (this._vcs === VcsEnum.GIT)
                    strUpToDate = 'Already up to date.';
                else if (this._vcs === VcsEnum.SVN)
                    strUpToDate = 'Updating \'.\':' + os.EOL + 'At revision';
                if (msg) {
                    if (msg.startsWith(strUpToDate))
                        Logger.info("[App] Already up to date");
                    else {
                        Logger.info("[App] ✔ Updated");
                        bUpdated = true;
                    }
                } else
                    throw new Error('Missing response from update process');
            } catch (error) {
                if (error['message'])
                    msg = error['message']; // 'Command failed:...'
                else
                    msg = error;
                console.error(msg);
                Logger.error("[App] ✘ Update failed");
            } finally {
                res.send(msg.replace('\n', '<br/>'));
            }
            if (bUpdated)
                this.restart();
            return Promise.resolve();
        }.bind(this));
        systemRouter.get('/restart', function (req, res) {
            res.send("Restarting..");
            this.restart();
        }.bind(this));
        systemRouter.get('/reload', async function (req, res) {
            var bForceMigration = (req.query['forceMigration'] === 'true');
            try {
                if (this._info['state'] === 'openRestartRequest') {
                    res.send("Restarting instead of reloading because of open request.");
                    this.restart();
                }

                Logger.info("[App] Reloading models");
                await this._shelf.loadAllModels();
                if (await this._migrationsController.migrateDatabase(bForceMigration)) {
                    await this._shelf.initAllModels();
                    var msg = "Reload done.";

                    if (this._info['state'] === 'openRestartRequest') {
                        res.send(msg + " Restarting now.");
                        this.restart();
                    } else
                        res.send(msg);
                } else
                    res.send("Reload aborted");
            } catch (error) {
                Logger.parseError(error);
                res.status(500);
                res.send("Reload failed");
            }
            return Promise.resolve();
        }.bind(this));
        systemRouter.get('/shutdown', async () => {
            process.exit();
        });
        app.use('/system', systemRouter);

        var apiRouter = express.Router();
        apiRouter.route('*')
            .all(async function (req, res, next) {
                try {
                    var match;
                    for (var route of this._routes) {
                        if (route['regex'] && route['fn']) {
                            match = new RegExp(route['regex'], 'ig').exec(req.path);
                            if (match) {
                                if (!req.locals)
                                    req.locals = { 'match': match };
                                else
                                    req.locals['match'] = match;
                                await route['fn'](req, res);
                                break;
                            }
                        }
                    }
                    if (!match)
                        await this.process(req, res);
                } catch (error) {
                    var msg = Logger.parseError(error);
                    if (error) {
                        if (error instanceof ValidationError) {
                            res.status(404);
                            res.send(error.message);
                        } else if (error.message && error.message === "EmptyResponse") {
                            res.status(404);
                            res.send(error.message);
                        } else {
                            res.status(500);
                            res.send(msg);
                        }
                    }
                }
                if (!res.headersSent)
                    next();
                return Promise.resolve();
            }.bind(this));
        app.use('/api', apiRouter);

        this._svr = app.listen(this._serverConfig.port, function () {
            Logger.info(`[Express] ✔ Server listening on port ${this._serverConfig.port} in ${app.get('env')} mode`);
        }.bind(this));

        this._svr.setTimeout(600 * 1000);
    }

    /**
     * https://stackoverflow.com/questions/630453/what-is-the-difference-between-post-and-put-in-http
     * To satisfy the definition that PUT is idempotent a PUT request must contain an ID.
     * An interpretation of an PUT request without ID would be to replace all data with the new one which won't be supported by now.
     * @param {*} req 
     * @param {*} res 
     * @returns 
     */
    async process(req, res) {
        var name;
        var id;
        var rel;

        var arr = req.params[0].split('/');
        var str = arr.shift();
        if (str === '') {
            name = arr.shift();
            if (name) {
                if (name.startsWith('_') && req.method !== "GET" && name !== '_registry') {
                    if (name === '_model') {
                        if (req.method === "PUT") {
                            id = await this.putModel(req, res);
                            res.json(id);

                            /*if (this._info['state'] === 'openRestartRequest')
                                this.restart(); */ // dont restart in case of importing multiple models at once 
                            return Promise.resolve();
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
                                try {
                                    var foo = await this._shelf.deleteModel(id);
                                    var change = {
                                        'method': req.method,
                                        'model': '_models',
                                        'record_id': id,
                                        'data': JSON.stringify(req.body)
                                    };
                                    await this._shelf.getModel('_change').create(change);
                                    Logger.info("[App] ✔ Deleted model '" + foo + "'");
                                    res.send("OK");
                                    return Promise.resolve();
                                } catch (error) {
                                    Logger.parseError(error);
                                    throw new ValidationError("Deletion of model failed");
                                }
                            } else
                                throw new ValidationError("Invalid model ID");
                        }
                    } else
                        throw new ValidationError("Modification of system models prohibited!");
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
                            var change = {
                                'timestamp': timestamp,
                                'method': req.method,
                                'model': name,
                                'record_id': id,
                                'data': JSON.stringify(req.body)
                            };
                            await this._shelf.getModel('_change').create(change);
                        }

                        if (req.method === "DELETE")
                            res.send("OK");
                        else if (data)
                            res.json(data);
                        else
                            res.json([]);
                        return Promise.resolve();
                    } else
                        throw new ValidationError("Model '" + name + "' not defined");
                }
            }
        }
        throw new ValidationError("Invalid path");
    }

    async putModel(req) {
        if (req.params[0] === '/_model') {
            var version = req.query['v'];
            var bForceMigration = (req.query['forceMigration'] === 'true');
            if (version) {
                var definition = req.body;
                var name = definition['name'];
                var appVersion = this._versionController.getVersion();
                var sAppVersion = appVersion.toString();
                if (version !== sAppVersion) {
                    var modelVersion = new AppVersion(version);
                    if (MigrationController.compatible(modelVersion, appVersion) || bForceMigration) {
                        definition = MigrationController.updateModelDefinition(definition, modelVersion, appVersion);
                        Logger.info("[MigrationController] ✔ Updated definition of model '" + name + "' to version '" + sAppVersion + "'");
                    } else
                        throw new ValidationError("An update of the minor release version may result in faulty models! Force only after studying changelog!");
                }
                var model = await this._shelf.upsertModel(undefined, definition);
                var id = model.getId();
                var change = {
                    'method': req.method,
                    'model': '_models',
                    'record_id': id,
                    'data': JSON.stringify(req.body)
                };
                await this._shelf.getModel('_change').create(change);
                Logger.info("[App] ✔ Creation or replacement of model '" + name + "' successful");
                return Promise.resolve(id);
            } else
                throw new ValidationError("Please specify model version");
        } else {
            if (req.params[0].startsWith('/_model/')) {
                var arr = req.params[0].substring('/_model/'.length).split('/');
                var id;
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
                                    await this._shelf.upsertModel(id, definition, false);
                                    var change = {
                                        'method': req.method,
                                        'model': '_models',
                                        'record_id': id,
                                        'data': JSON.stringify(req.body)
                                    };
                                    await this._shelf.getModel('_change').create(change);
                                    Logger.info("[App] ✔ Updated model '" + model.getName() + "'");
                                    return Promise.resolve(id);
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
        throw new ValidationError("Invalid path");
    }
}

module.exports = new Controller();