const path = require('path');
const fs = require('fs');

const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const formidable = require('express-formidable');
const session = require('express-session');

const _eval = require('eval');

const Logger = require('../common/logger/logger');
const SeverityEnum = require('../common/logger/severity-enum');
const ValidationError = require('../common/validation-error');
const VcsEnum = require('../common/vcs-enum');
const AuthController = require('./auth-controller');

class WebServer {

    _controller;

    _app;
    _svr;

    _routes;

    constructor(controller) {
        this._controller = controller;

        var config = controller.getServerConfig();
        this._app = this._initApp(config);
        this._addRoutes();

        this._routes = [];
    }

    _initApp(config) {
        var app = express();
        //app.set("json spaces", 2);
        //app.set("query parser", "simple");

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
        if (config['ssl']) { // Chrome only allows cookie forwarding for https
            sessOptions['cookie'] = {
                sameSite: "none",
                secure: true
            };
        }

        app.use(cors(corsOptions));
        app.use((req, res, next) => {
            if (this._controller.isRunning())
                next();
            else {
                res.status(503);
                res.send("Server is not fully started yet. Please retry.");
            }
        });
        app.use(session(sessOptions));
        if (config['auth'] == undefined || config['auth'] == true)
            app.use(this._checkAuthorization.bind(this));

        app.use(express.urlencoded({ limit: '100mb', extended: true }));
        app.use(express.json({ limit: '100mb' }));
        app.use(formidable());

        app.get('/robots.txt', function (req, res) {
            res.type('text/plain');
            res.send("User-agent: *\nDisallow: /");
        });
        //app.use('/robots.txt', express.static('robots.txt'));

        return app;
    }

    _checkAuthorization(req, res, next) {
        var bAuth = false;
        var ac = this._controller.getAuthController();
        if (ac)
            bAuth = ac.checkAuthorization(req, res, next);
        return bAuth;
    }

    async initServer() {
        this._svr = await this._initServer(this._app, this._controller.getServerConfig(), this._controller.getAppRoot());
        return Promise.resolve();
    }

    async _initServer(app, config, appRoot) {
        var server;
        if (config['ssl']) {
            const options = {
                key: fs.readFileSync(path.join(appRoot, 'config/ssl/key.pem'), 'utf8'),
                cert: fs.readFileSync(path.join(appRoot, 'config/ssl/cert.pem'), 'utf8')
            };

            if (options)
                server = https.createServer(options, app);
            else {
                var msg = "No valid SSL certificate found";
                console.error(msg);
                Logger.error("[App] ✘ " + msg);
            }
        } else
            server = http.createServer(app);
        if (server) {
            server.setTimeout(600 * 1000);
            return new Promise(function (resolve, reject) {
                server.listen(config['port'], function () {
                    Logger.info(`[Express] ✔ Server listening on port ${config['port']} in ${app.get('env')} mode`);
                    resolve(this);
                });
                server.once('error', (err) => {
                    if (err)
                        reject(err);
                });
            });
        }
        return Promise.reject();
    }

    getServer() {
        return this._svr;
    }

    addCustomRoute(route) {
        if (route['regex'] && route['fn']) {
            this.deleteCustomRoute(route);
            this._routes.push(route);
        }
    }

    deleteCustomRoute(route) {
        if (route['regex']) {
            this._routes = this._routes.filter(function (x) {
                return (x['regex'] !== route['regex']);
            });
        }
    }

    _addRoutes() {
        this._app.get('/', function (req, res) {
            if (this._controller.getServerConfig()['ssl']) {
                if (req.session.user)
                    AuthController.greeting(req, res);
                else
                    res.redirect('/sys/auth/login');
            } else
                res.send('Hello');
        }.bind(this));

        this._addSystemRoutes();
        this._addApiRoute();
    }

    _addSystemRoutes() {
        var systemRouter = express.Router();
        systemRouter.get('/info', function (req, res) {
            res.json(this._info);
        }.bind(this._controller));
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
        }.bind(this._controller));
        systemRouter.get('/restart', function (req, res) {
            res.send("Restarting..");
            this.restart();
        }.bind(this._controller));
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
        }.bind(this._controller));
        systemRouter.get('/shutdown', (req, res) => {
            res.send("Shutdown initiated");
            process.exit();
        });
        if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
            const evalForm = '<form action="/sys/eval" method="post">' +
                'Command:<br><textarea name="cmd" rows="4" cols="50"></textarea><br>' +
                '<input type="submit" value="Evaluate"></form>';

            systemRouter.get('/eval', (req, res) => {
                res.send(evalForm);
            });
            systemRouter.post('/eval', async (req, res) => {
                var cmd = req.body['cmd'];
                var response;
                if (cmd) {
                    Logger.info("[App] Evaluating command '" + cmd + "'");
                    try {
                        //response = eval(code);
                        var e = _eval(cmd, true);
                        response = await e();
                    } catch (error) {
                        response = error.toString();
                    }
                    if (response && (typeof response === 'string' || response instanceof String))
                        response = response.replaceAll('\n', '<br>');
                }
                res.send(response + '<br>' + evalForm);
                return Promise.resolve();
            });

            const form = '<form action="/sys/run" method="post">' +
                'Command:<br><textarea name="code" rows="4" cols="50"></textarea><br>' +
                '<input type="submit" value="Run"></form>';

            systemRouter.get('/run', (req, res) => {
                res.send(form);
            });
            systemRouter.post('/run', async (req, res) => {
                var code = req.body['code'];
                var response;
                if (code) {
                    Logger.info("[App] Running code '" + code + "'");
                    try {
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
                '<input type="submit" value="Execute"></form>';

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
        }.bind(this._controller));
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

        this._app.use('/sys', systemRouter);
    }

    _addApiRoute() {
        var apiRouter = express.Router();
        apiRouter.route('*')
            .all(async function (req, res, next) {
                var bSent = false;
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
                        await this._controller.processRequest(req, res);
                    bSent = true;
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
                if (!bSent && !res.headersSent)
                    next();
                return Promise.resolve();
            }.bind(this));
        this._app.use('/api', apiRouter);
    }

    async teardown() {
        return new Promise(function (resolve, reject) {
            if (this._svr) {
                this._svr.close(function (err) {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            } else
                resolve();
        }.bind(this));
    }
}

module.exports = WebServer;