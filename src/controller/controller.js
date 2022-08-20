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

class Controller {

    _info;
    _appRoot;
    _vcs;

    _serverConfig;
    _databaseConfig;

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

        if (fs.existsSync(path.join(this._appRoot, '.git')))
            this._vcs = VcsEnum.GIT;
        else if (fs.existsSync(path.join(this._appRoot, '.svn')))
            this._vcs = VcsEnum.SVN;
    }

    getAppRoot() {
        return this._appRoot;
    }

    async setup(serverConfig, databaseConfig) {
        this._serverConfig = serverConfig;
        this._databaseConfig = databaseConfig;

        this._info = {
            'state': 'starting',
            'vcs': this._vcs
        };

        this._routes = {};

        try {
            var defaultConnection = this._databaseConfig['defaultConnection'];
            var databaseSettings;
            if (defaultConnection && this._databaseConfig['connections'] && this._databaseConfig['connections'][defaultConnection])
                databaseSettings = this._databaseConfig['connections'][defaultConnection]['settings'];
            else
                throw new Error('Faulty database configuration!');
            this._info['db_client'] = this._databaseConfig.connections.default.settings.client

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
            await this._logger.init();

            this._registry = new Registry(this._knex);
            await this._registry.init();

            this._shelf = new Shelf(this._knex);
            await this._shelf.init();
            await this._shelf.loadAllModels();

            this._versionController = new VersionController(this);
            this._info['version'] = this._versionController.getVersion().toString();
            this._migrationsController = new MigrationController(this);

            var res = await this._migrationsController.migrateDatabase();
            if (res)
                await this._shelf.initAllModels();

            this._startExpress();

            if (this._info['state'] === 'starting')
                this._info['state'] = 'running';
        } catch (error) {
            Logger.parseError(error);
        }
        return Promise.resolve();
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
            var bForce = (req.query['force'] === 'true');
            try {
                Logger.info("[App] Reloading models");
                await this._shelf.loadAllModels();
                if (await this._migrationsController.migrateDatabase(bForce)) {
                    await this._shelf.initAllModels();
                    res.send("Reload done");
                } else
                    res.send("Reload aborted");
            } catch (error) {
                Logger.parseError(error);
                res.status(500);
                res.send("Reload failed");
            }
            return Promise.resolve();
        }.bind(this));
        app.use('/system', systemRouter);

        var routesRouter = express.Router();
        routesRouter.get('/', async function (req, res) {
            var routes;
            var str = await this._registry.get('routes');
            if (str)
                routes = JSON.parse(str);
            res.json(routes);
        }.bind(this));
        routesRouter.put('/', async function (req, res) {
            var result = await this._registry.upsert('routes', JSON.stringify(req.body));
            res.json(result);
        }.bind(this));
        app.use('/routes', routesRouter);

        var profilesRouter = express.Router();
        profilesRouter.get('/', async function (req, res) {
            var profiles;
            var str = await this._registry.get('profiles');
            if (str)
                profiles = JSON.parse(str);
            res.json(profiles);
        }.bind(this));
        profilesRouter.put('/', async function (req, res) {
            var result = await this._registry.upsert('profiles', JSON.stringify(req.body));
            res.json(result);
        }.bind(this));
        app.use('/profiles', profilesRouter);

        var bookmarksRouter = express.Router();
        bookmarksRouter.get('/', async function (req, res) {
            var bookmarks;
            var str = await this._registry.get('bookmarks');
            if (str)
                bookmarks = JSON.parse(str);
            res.json(bookmarks);
        }.bind(this));
        bookmarksRouter.put('/', async function (req, res) {
            var result = await this._registry.upsert('bookmarks', JSON.stringify(req.body));
            res.json(result);
        }.bind(this));
        app.use('/bookmarks', bookmarksRouter);

        var modelsRouter = express.Router();
        modelsRouter.get('/', function (req, res) {
            var arr = [];
            var definition;
            for (const [key, value] of Object.entries(this._shelf.getModels())) {
                definition = { ...value.getDefinition() };
                definition['id'] = value.getId();
                arr.push(definition);
            }
            res.json(arr);
        }.bind(this));
        modelsRouter.put('/', async function (req, res) {
            var version = req.query['v'];
            var bForce = (req.query['force'] === 'true');
            if (version) {
                var bError = false;
                var err;
                var definition = req.body;
                try {
                    var appVersion = this._versionController.getVersion();
                    var sAppVersion = appVersion.toString();
                    if (version !== sAppVersion) {
                        var modelVersion = new AppVersion(version);
                        if (MigrationController.compatible(modelVersion, appVersion) || bForce) {
                            definition = MigrationController.updateModelDefinition(definition, modelVersion, appVersion);
                            Logger.info("[MigrationController] ✔ Updated definition of model '" + definition['name'] + "' to version '" + sAppVersion + "'");
                        } else {
                            Logger.info("[MigrationController] ✘ An update of the minor release version may result in faulty models! Force only after studying changelog!");
                            bError = true;
                        }
                    }
                    if (!bError) {
                        var id = await this._shelf.upsertModel(undefined, definition);
                        await this._logger.logChange(null, req.method, '_models', id, req.body);
                        Logger.info("[App] ✔ Creation or replacement of model '" + definition['name'] + "' successful");
                        res.json(id);
                    }
                } catch (error) {
                    err = error;
                }
                if (bError || err) {
                    var msg = "Creation or replacement of model";
                    if (definition['name'])
                        msg += " '" + definition['name'] + "'";
                    msg += " failed";
                    if (err)
                        Logger.parseError(err, msg);
                    res.status(500);
                    res.send(msg);
                }
            } else {
                res.status(500);
                res.send("Please specify model version");
            }
            return Promise.resolve();
        }.bind(this));
        modelsRouter.put('/:id/*', async function (req, res, next) {
            try {
                var id;
                if (!isNaN(req.params.id))
                    id = parseInt(req.params.id);
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
                        var p = req.params[0];
                        if (p) {
                            if (p.startsWith('states')) {
                                var definition = model.getDefinition();
                                definition['states'] = req.body;
                                await this._shelf.upsertModel(id, definition, false);
                                await this._logger.logChange(null, req.method, '_models', id, req.body);
                                Logger.info("[App] ✔ Updated model '" + model.getName() + "'");
                                res.json(id);
                            } else if (p.startsWith('filters')) {
                                var definition = model.getDefinition();
                                definition['filters'] = req.body;
                                await this._shelf.upsertModel(id, definition, false);
                                await this._logger.logChange(null, req.method, '_models', id, req.body);
                                Logger.info("[App] ✔ Updated model '" + model.getName() + "'");
                                res.json(id);
                            } else if (p.startsWith('defaults')) {
                                p = p.substring(9);
                                if (p === "view") {
                                    var definition = model.getDefinition();
                                    var defaults = definition['defaults'];
                                    if (!defaults) {
                                        defaults = {};
                                        definition['defaults'] = defaults;
                                    }
                                    defaults['view'] = req.body;
                                    await this._shelf.upsertModel(id, definition, false);
                                    await this._logger.logChange(null, req.method, '_models', id, req.body);
                                    Logger.info("[App] ✔ Updated model '" + model.getName() + "'");
                                    res.json(id);
                                }
                            }
                        }
                        if (!res.headersSent)
                            next();
                    } else {
                        res.status(404);
                        res.send("Invalid model ID");
                    }
                } else {
                    res.status(404);
                    res.send("Invalid model ID");
                }
            } catch (error) {
                Logger.parseError(error);
                res.status(500);
                res.send("Update of model failed");
            }
            return Promise.resolve();
        }.bind(this));
        modelsRouter.delete('/:id', async function (req, res) {
            try {
                var id;
                if (!isNaN(req.params.id))
                    id = parseInt(req.params.id);
                if (id) {
                    var name = await this._shelf.deleteModel(id);
                    await this._logger.logChange(null, req.method, '_models', id, req.body);
                    Logger.info("[App] ✔ Deleted model '" + name + "'");
                    res.send("OK");
                } else {
                    res.status(404);
                    res.send("Invalid model ID");
                }
            } catch (error) {
                Logger.parseError(error);
                res.status(500);
                res.send("Deletion of model failed");
            }
            return Promise.resolve();
        }.bind(this));
        app.use('/models', modelsRouter);

        var apiRouter = express.Router();
        apiRouter.route('*')
            .all(async function (req, res) {
                try {
                    var data;
                    if (this._routes[req.url])
                        data = await this._routes[req.url](req, res);
                    else {
                        data = await this.process(req, res);
                        if (!res.headersSent) {
                            if (req.method === "DELETE")
                                res.send("OK");
                            else if (data)
                                res.json(data);
                            else
                                res.json([]);
                        }
                    }
                } catch (err) {
                    if (err && err.message && err.message === "EmptyResponse") {
                        res.status(404);
                        res.send(err.message);
                    } else {
                        var msg = Logger.parseError(err);
                        res.status(500);
                        res.send(msg);
                    }
                }
                return Promise.resolve();
            }.bind(this));
        app.use('/api', apiRouter);

        var changesRouter = express.Router();
        changesRouter.get('/', function (req, res) {
            try {
                res.status(200);
                res.send('TODO'); //TODO:
            } catch (err) {
                var msg = Logger.parseError(err);
                res.status(500);
                res.send(msg);
            }
            return Promise.resolve();
        }.bind(this));
        app.use('/changes', changesRouter);

        this._svr = app.listen(this._serverConfig.port, function () {
            Logger.info(`[Express] ✔ Server listening on port ${this._serverConfig.port} in ${app.get('env')} mode`);
        }.bind(this));

        this._svr.setTimeout(600 * 1000);
    }

    async update(version, bForce) {
        var response;
        Logger.info("[App] Processing update request..");
        if (this._vcs) {
            var updateCmd = "";
            if (this._vcs === VcsEnum.GIT) {
                if (version) {
                    if (version === 'latest')
                        updateCmd += 'git pull origin main';
                    else
                        updateCmd += 'git switch --detach ' + version;
                } else {
                    if (bForce)
                        updateCmd += 'git reset --hard && '; //git clean -fxd
                    updateCmd += 'git pull';
                }
            } else if (this._vcs === VcsEnum.SVN)
                updateCmd = 'svn update';

            response = await common.exec('cd ' + this._appRoot + ' && ' + updateCmd + ' && npm install --legacy-peer-deps');
        } else
            throw new Error('No version control system detected');
        return Promise.resolve(response);
    }

    teardown() {
        this._svr.close();
        this._knex.destroy();
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

        var data;

        var parts;
        var index = parts.indexOf('?');
        if (index == -1)
            parts = req.url.substring(1);
        else
            parts = req.url.substring(1, index);

        parts = parts.split('/');
        if (parts.length == 1) {
            name = parts[0];
        } else if (parts.length == 2) {
            name = parts[0];
            id = parts[1];
        } else if (parts.length == 3) {
            name = parts[0];
            id = parts[1];
            rel = parts[2];
        }

        if (name) {
            var model = this._shelf.getModel(name);
            if (model) {
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
                        data = await model.delete(id);
                        timestamp = this._knex.fn.now();
                        break;
                    default:
                        throw new Error("Unsuppourted method")
                }

                if (timestamp) { //req.method !== "GET"
                    try {
                        await this._logger.logChange(timestamp, req.method, name, id, req.body);
                    } catch (error) {
                        Logger.parseError(error);
                    }
                }
            } else
                throw new Error("Model '" + name + "' not defined");
        } else
            throw new Error("Invalid path");
        return Promise.resolve(data);
    }

    getServerConfig() {
        return this._serverConfig;
    }

    getDatabaseConfig() {
        return this._databaseConfig;
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

    addRoute(path, func) {
        this._routes[path] = func;
    }

    async installDependencies(arr) {
        var file = path.join(this._appRoot, 'package.json');

        var before = fs.readFileSync(file, 'utf8');
        //var pkg = JSON.parse(str);
        //console.log(pkg['dependencies']);

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

        await common.exec('add-dependencies ' + file + ' ' + arr.join(' ') + ' --no-overwrite');

        var after = fs.readFileSync(file, 'utf8');

        if (before !== after) {
            Logger.info('Dependencies changed - installing new software');
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
}

module.exports = new Controller();