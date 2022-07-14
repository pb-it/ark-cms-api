const path = require('path');
const Logger = require('../logger');
const Registry = require('./registry');
const VersionController = require('./version-controller');
const Shelf = require('../model/shelf');

class Controller {

    _appRoot;

    _serverConfig;
    _databaseConfig;

    _knex;
    _svr;

    _logger;
    _registry;
    _versionController;
    _profileController;
    _shelf;

    constructor() {
        this._appRoot = path.join(__dirname, "../../");
    }

    async setup(serverConfig, databaseConfig) {
        this._serverConfig = serverConfig;
        this._databaseConfig = databaseConfig;

        try {
            var defaultSettings = this._databaseConfig.connections.default.settings;
            this._knex = require('knex')({
                client: defaultSettings.client,
                connection: defaultSettings.connection
            });
            /*this._knex.on('query', function (queryData) {
                console.log(queryData);
            });*/

            try {
                await this._knex.raw('select 1+1 as result');
                Logger.info("[knex] ✔ Successfully connected to " + defaultSettings.client + " on " + defaultSettings.connection.host);
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
            await this._shelf.loadModels();

            this._versionController = new VersionController(this);
            await this._versionController.verify();

            await this._shelf.initModels();

            this._startExpress();
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

        var systemRouter = express.Router();
        systemRouter.get('/info', function (req, res) {
            var info = {};
            info['version'] = this._versionController.getVersion();
            info['client'] = this._databaseConfig.connections.default.settings.client;
            res.json(info);
        }.bind(this));
        systemRouter.use('/log', express.static('log.txt'));
        systemRouter.get('/update', function (req, res) {
            Logger.info(`Updating`);
            require("child_process").exec('cd ' + this._appRoot + ' && git pull && npm update', function (err, stdout, stderr) {
                if (err)
                    console.error(`exec error: ${err}`);
                else {
                    console.log(stdout);
                    this.restart();
                }
            }.bind(this));
            res.send("Updating..");
        }.bind(this));
        systemRouter.get('/restart', function (req, res) {
            this.restart();
            res.send("Restarting..");
        }.bind(this));
        systemRouter.get('/reload', async function (req, res) {
            try {
                Logger.info(`Reloading models`);
                await this._shelf.loadModels();
                await this._shelf.initModels();
                res.send("Reload done");
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
            for (const [key, value] of Object.entries(this._shelf.getModels())) {
                arr.push(value.getData());
            }
            res.json(arr);
        }.bind(this));
        modelsRouter.put('/', async function (req, res, next) {
            try {
                var id = await this._shelf.upsertModel(req.body);
                res.locals.id = id;
                await next();
            } catch (error) {
                Logger.parseError(error);
                res.status(500);
                res.send("Creation or replacement of model failed");
            }
            return Promise.resolve();
        }.bind(this));
        modelsRouter.delete('/:id', async function (req, res, next) {
            try {
                var id;
                if (!isNaN(req.params.id))
                    id = parseInt(req.params.id);
                if (id) {
                    await this._shelf.deleteModel(id);
                    res.locals.id = id;
                    await next();
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
        modelsRouter.use(async function (req, res) {
            try {
                await this._logger.logRequest(null, req.method, '_models', res.locals.id, req.body);
            } catch (error) {
                Logger.parseError(error);
            }
            if (req.method === "DELETE")
                res.send("OK");
            else
                res.json(res.locals.id);
            return Promise.resolve();
        }.bind(this));
        app.use('/models', modelsRouter);

        var apiRouter = express.Router();
        apiRouter.route('*')
            .all(async function (req, res, next) {
                try {
                    var data = await this.process(req, res);
                    if (!res.headersSent) {
                        if (req.method === "DELETE")
                            res.send("OK");
                        else if (data)
                            res.json(data);
                        else
                            res.json([]);
                    }
                } catch (err) {
                    next(err);
                }
                return Promise.resolve();
            }.bind(this));
        app.use('/api', apiRouter);

        app.use(function (err, req, res, next) {
            if (err && err.message && err.message === "EmptyResponse") {
                res.status(404);
                res.send(err.message);
            } else {
                var msg = Logger.parseError(err);
                res.status(500);
                res.send(msg);
            }
        });

        this._svr = app.listen(this._serverConfig.port, function () {
            Logger.info(`[Express] ✔ Server listening on port ${this._serverConfig.port} in ${app.get('env')} mode`);
        }.bind(this));

        this._svr.setTimeout(600 * 1000);
    }

    teardown() {
        this._svr.close();
        this._knex.destroy();
    }

    restart() {
        Logger.info(`Restarting`);
        if (!this._serverConfig.pm2) {
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

        var parts = req.url.substring(1);
        var index = parts.indexOf('?');
        if (index != -1)
            parts = parts.substring(0, index);

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
                        await this._logger.logRequest(timestamp, req.method, name, id, req.body);
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

    getVersionController() {
        return this._versionController;
    }

    getShelf() {
        return this._shelf;
    }
}

module.exports = new Controller();