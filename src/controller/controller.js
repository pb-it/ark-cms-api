const v8 = require('v8');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const session = require('express-session');

const Logger = require('../common/logger/logger');
const SeverityEnum = require('../common/logger/severity-enum');
const common = require('../common/common');
const WebClient = require('../common/webclient');
const Registry = require('./registry');
const VersionController = require('./version-controller');
const DependencyController = require('./dependency-controller');
const MigrationController = require('./migration-controller');
const AuthController = require('./auth-controller');
const AppVersion = require('../common/app-version');
const Shelf = require('../model/shelf');

const VcsEnum = Object.freeze({ GIT: 'git', SVN: 'svn' });

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}

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
    _svr;

    _logger;
    _registry;
    _webclient;
    _tmpDir;

    _versionController;
    _dependencyController;
    _migrationsController;
    _authController;

    _shelf;

    _routes;

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

        this._routes = [];

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

            this._shelf = new Shelf(this._knex);
            await this._shelf.initShelf();

            this._registry = new Registry(this._knex);
            await this._registry.initRegistry();

            this._webclient = new WebClient();

            this._versionController = new VersionController(this);
            this._info['version'] = this._versionController.getVersion().toString();

            this._dependencyController = new DependencyController(this);
            await this._dependencyController.init();

            this._migrationsController = new MigrationController(this);
            var res = await this._migrationsController.migrateDatabase();
            if (res)
                await this._shelf.initAllModels();

            this._authController = new AuthController();
            await this._authController.initAuthController();

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

    getDatabaseSettings() {
        return this._databaseSettings;
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

    getWebClient() {
        return this._webclient;
    }

    getMigrationsController() {
        return this._migrationsController;
    }

    getVersionController() {
        return this._versionController;
    }

    getDependencyController() {
        return this._dependencyController;
    }

    getShelf() {
        return this._shelf;
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
        return new Promise(function (resolve, reject) {
            if (this._svr)
                this._svr.close(function (err) {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            if (this._knex)
                this._knex.destroy();
            this._bIsRunning = false;
        }.bind(this));
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

    addRoute(route) {
        if (route['regex'] && route['fn']) {
            this.deleteRoute(route);
            this._routes.push(route);
        }
    }

    deleteRoute(route) {
        if (route['regex']) {
            this._routes = this._routes.filter(function (x) {
                return (x['regex'] !== route['regex']);
            });
        }
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
        var cors = require('cors');
        var corsOptions = {
            origin: function (origin, callback) {
                return callback(null, true);
            },
            credentials: true
        };
        var sessOptions = {
            secret: 'keyboard cat',
            //name: "sessionID",
            //proxy: true,
            resave: false,
            saveUninitialized: true
        };
        if (this._serverConfig.ssl) { // Chrome only allows cookie forwarding for https
            sessOptions['cookie'] = {
                sameSite: "none",
                secure: true
            };
        }
        var bodyParser = require('body-parser');

        var app = express();

        //app.set("json spaces", 2);
        //app.set("query parser", "simple");

        app.use(cors(corsOptions));
        app.use(session(sessOptions));
        if (this._serverConfig['auth'] == undefined || this._serverConfig['auth'] == true)
            app.use(this._authController.checkAuthorization.bind(this._authController));
        app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
        app.use(bodyParser.json({ limit: '100mb' }));

        app.get('/robots.txt', function (req, res) {
            res.type('text/plain');
            res.send("User-agent: *\nDisallow: /");
        });
        //app.use('/robots.txt', express.static('robots.txt'));

        app.get('/', function (req, res) {
            if (req.session.user)
                AuthController.greeting(req, res);
            else
                res.redirect('/sys/auth/login');
        });

        var systemRouter = express.Router();
        systemRouter.get('/info', function (req, res) {
            res.json(this._info);
        }.bind(this));
        systemRouter.get('/log', function (req, res) {
            if (req.query['clear'] === 'true') {
                var response;
                try {
                    Logger.clear();
                    response = "Log cleared!";
                } catch (error) {
                    Logger.parseError(error);
                }
                if (response)
                    res.send(response);
                else {
                    res.status(500);
                    res.send("Something went wrong!");
                }
            } else {
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
            }
        });
        systemRouter.get('/update', async function (req, res) {
            var version;
            if (req.query['v'])
                version = req.query['v'];
            else if (req.query['version'])
                version = req.query['version'];
            var bForce = req.query['force'] && (req.query['force'] === 'true');
            var msg;
            var bUpdated = false;
            try {
                msg = await this.update(version, bForce);
                console.log(msg);
                var strUpToDate;
                if (this._vcs === VcsEnum.GIT)
                    strUpToDate = 'Already up to date.'; // 'Bereits aktuell.' ... localize
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
                } else {
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
                }
            } catch (error) {
                Logger.parseError(error);
                res.status(500);
                res.send("Reload failed");
            }
            return Promise.resolve();
        }.bind(this));
        systemRouter.get('/shutdown', (req, res) => {
            res.send("Shutdown initiated");
            process.exit();
        });
        if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
            const form = '<form action="/sys/run" method="post">' +
                'Command:<br><textarea name="code" rows="4" cols="50"></textarea><br>' +
                '<input type="submit" text="Run"></form>';

            systemRouter.get('/run', (req, res) => {
                res.send(form);
            });
            systemRouter.post('/run', async (req, res) => {
                var code = req.body['code'];
                var response;
                if (code) {
                    Logger.info("[App] Running code '" + code + "'");
                    try {
                        //response = eval(code);
                        //response = new Function(code)();
                        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                        response = await new AsyncFunction(code)();
                    } catch (error) {
                        response = error.toString();
                    }
                    if (response && (typeof response === 'string' || response instanceof String))
                        response = response.replaceAll('\n', '<br>');
                }
                if (!response)
                    response = 'Empty response!'; //'An error occurred while processing your request!'
                res.send(response + '<br><br>' + form);
                return Promise.resolve();
            });

            const execForm = '<form action="/sys/exec" method="post">' +
                'Command:<br><textarea name="cmd" rows="4" cols="50"></textarea><br>' +
                '<input type="submit" text="Execute"></form>';

            systemRouter.get('/exec', (req, res) => {
                res.send(execForm);
            });
            systemRouter.post('/exec', async (req, res) => {
                var cmd = req.body['cmd'];
                var response;
                if (cmd) {
                    Logger.info("[App] Executing command '" + cmd + "'");
                    try {
                        response = await common.exec(cmd);
                    } catch (error) {
                        response = error.toString();
                    }
                    if (response && (typeof response === 'string' || response instanceof String))
                        response = response.replaceAll('\n', '<br>');
                }
                res.send(response + '<br>' + execForm);
                return Promise.resolve();
            });
        }
        app.use('/sys', systemRouter);

        var dbRouter = express.Router();
        dbRouter.get('/backup', async function (req, res) {
            if (process.platform === 'linux' && this._databaseSettings['client'].startsWith('mysql')) {
                try {
                    var password;
                    if (req.query['password'])
                        password = req.query['password'];
                    else
                        password = this._databaseSettings['connection']['password'];
                    var file = controller.getTmpDir() + "/cms_" + createDateTimeString() + ".sql";
                    var cmd = `mysqldump --verbose -u root -p${password} \
            --add-drop-database --opt --skip-set-charset --default-character-set=utf8mb4 \
            --databases cms > ${file}`;
                    Logger.info("[App] Creating database dump to '" + file + "'");
                    await common.exec(cmd);
                } catch (error) {
                    console.log(error);
                    file = null;
                }
                if (file)
                    res.download(file);
                else
                    res.send("Something went wrong!");
            } else
                res.send("By now backup API is only supported with mysql on local linux systems!");
            return Promise.resolve();
        }.bind(this));
        dbRouter.get('/restore', function (req, res) {
            res.send("Not Implemented Yet"); //TODO:
        });
        dbRouter.post('/restore', function (req, res) {
            res.send("Not Implemented Yet"); //TODO:
        });
        systemRouter.use('/db', dbRouter);

        var authRouter = express.Router();
        authRouter.get('/login', function (req, res) {
            AuthController.showLoginDialog(res);
        });
        authRouter.post('/login', express.urlencoded({ extended: false }), async function (req, res) {
            var username = req.body.user;
            var password = req.body.pass;
            var user;
            if (username && password)
                user = await this._authController.checkAuthentication(username, password);
            if (user) {
                req.session.regenerate(function (err) {
                    if (err)
                        next(err);
                    req.session.user = user;
                    req.session.save(function (err) {
                        if (err)
                            return next(err);
                        res.redirect('/');
                    });
                });
            } else
                res.redirect('/sys/auth/login');
            return Promise.resolve();
        }.bind(this));
        authRouter.get('/logout', function (req, res, next) {
            req.session.user = null;
            req.session.save(function (err) {
                if (err)
                    next(err);
                req.session.regenerate(function (err) {
                    if (err)
                        next(err);
                    res.redirect('/');
                });
            });
        });
        systemRouter.use('/auth', authRouter);

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

        if (this._serverConfig.ssl) {
            const options = {
                key: fs.readFileSync(path.join(this._appRoot, 'config/ssl/key.pem'), 'utf8'),
                cert: fs.readFileSync(path.join(this._appRoot, 'config/ssl/cert.pem'), 'utf8')
            };

            if (options) {
                this._svr = https.createServer(options, app);
                this._svr.listen(this._serverConfig.port, function () {
                    Logger.info(`[Express] ✔ Server listening on port ${this._serverConfig.port} in ${app.get('env')} mode`);
                }.bind(this));
            } else {
                var msg = "No valid SSL certificate found";
                console.error(msg);
                Logger.error("[App] ✘ " + msg);
            }
        } else {
            this._svr = http.createServer(app);
            this._svr.listen(this._serverConfig.port, function () {
                Logger.info(`[Express] ✔ Server listening on port ${this._serverConfig.port} in ${app.get('env')} mode`);
            }.bind(this));
        }
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
                if (name === '_model' && req.method !== "GET") {
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
                                if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
                                    var user = req.session.user;
                                    var uid;
                                    if (user)
                                        uid = user['id'];
                                    else
                                        uid = null;
                                    var change = {
                                        'method': req.method,
                                        'model': '_model',
                                        'record_id': id,
                                        'data': JSON.stringify(req.body),
                                        'user': uid
                                    };
                                    await this._shelf.getModel('_change').create(change);
                                }
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
                            if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
                                var user = req.session.user;
                                var uid;
                                if (user)
                                    uid = user['id'];
                                else
                                    uid = null;
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
                                var change = {
                                    'timestamp': timestamp,
                                    'method': req.method,
                                    'model': name,
                                    'record_id': id,
                                    'data': JSON.stringify(protocol),
                                    'user': uid
                                };
                                await this._shelf.getModel('_change').create(change);
                            }
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
                var id = model.getId();
                var data = await this._shelf.getModel('_model').read(id);
                var timestamp = data['updated_at'];
                var user = req.session.user;
                var uid;
                if (user)
                    uid = user['id'];
                else
                    uid = null;
                if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
                    var change = {
                        'timestamp': timestamp,
                        'method': req.method,
                        'model': '_model',
                        'record_id': id,
                        'data': JSON.stringify(req.body),
                        'user': uid
                    };
                    await this._shelf.getModel('_change').create(change);
                }
                if (bNew && user && user.username !== 'admin') {
                    var permission = {
                        'user': uid,
                        'model': id,
                        'read': true,
                        'write': true
                    };
                    model = this._shelf.getModel('_permission');
                    data = await model.create(permission);
                    if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
                        var pid = data['id'];
                        timestamp = data['created_at'];
                        change = {
                            'timestamp': timestamp,
                            'method': 'POST',
                            'model': '_permission',
                            'record_id': pid,
                            'data': JSON.stringify(permission),
                            'user': uid
                        };
                        await this._shelf.getModel('_change').create(change);
                    }
                }
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
                                    if (!this._serverConfig.hasOwnProperty('protocol') || this._serverConfig['protocol']) {
                                        var user = req.session.user;
                                        var uid;
                                        if (user)
                                            uid = user['id'];
                                        else
                                            uid = null;
                                        var change = {
                                            'method': req.method,
                                            'model': '_model',
                                            'record_id': id,
                                            'data': JSON.stringify(req.body),
                                            'user': uid
                                        };
                                        await this._shelf.getModel('_change').create(change);
                                    }
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