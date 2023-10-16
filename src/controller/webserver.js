const path = require('path');
const fs = require('fs');

const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const formData = require('express-form-data');
const session = require('express-session');

const ejs = require('ejs');
const _eval = require('eval');
const unzipper = require("unzipper");

const common = require('../common/common');
const Logger = require('../common/logger/logger');
const SeverityEnum = require('../common/logger/severity-enum');
const ValidationError = require('../common/validation-error');
const VcsEnum = require('../common/vcs-enum');
const { AuthController } = require('./auth-controller');
const { AuthError } = require('./auth-controller');
const { ExtensionError } = require('./extension-controller');
const AppVersion = require('../common/app-version');

const renderFile = (file, data) => {
    return new Promise((resolve, reject) => {
        ejs.renderFile(file, data, (err, result) => {
            if (err)
                reject(err);
            else
                resolve(result);
        });
    });
}

class WebServer {

    static async _unzipFile(file, dest) {
        return new Promise((resolve, reject) => {
            fs.createReadStream(file)
                .pipe(unzipper.Extract({ 'path': dest }))
                .on('error', reject)
                .on('finish', resolve);
            //.promise()
            //.then(() => resolve(), e => reject(e));
        });
    }

    _controller;

    _apiVersion;
    _config;
    _app;
    _svr;

    _routes;
    _extRoutes;

    constructor(controller) {
        this._controller = controller;

        this._apiVersion = this._controller.getInfo()['api']['version'];
        this._config = this._controller.getServerConfig();
        this._app = this._initApp(this._config);
        this._addRoutes();

        this._routes = [];
        this._extRoutes = [];
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
        app.use(formData.parse());

        app.get('/robots.txt', function (req, res) {
            res.type('text/plain');
            res.send("User-agent: *\nDisallow: /");
        });

        return app;
    }

    async _checkAuthorization(req, res, next) {
        var ac = this._controller.getAuthController();
        if (ac)
            await ac.checkAuthorization(req, res, next);
        else
            res.sendStatus(401);
        return Promise.resolve();
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
            /*server.setTimeout(600 * 1000, (socket) => {
                console.log('timeout');
                socket.destroy();
            });*/
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

    getApp() {
        return this._app;
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

    deleteAllCustomRoutes() {
        this._routes = [];
    }

    addExtensionRoute(route) {
        if (route['regex'] && route['fn']) {
            this.deleteExtensionRoute(route);
            this._extRoutes.push(route);
        }
    }

    deleteExtensionRoute(route) {
        if (route['regex']) {
            this._extRoutes = this._extRoutes.filter(function (x) {
                return (x['regex'] !== route['regex']);
            });
        }
    }

    deleteAllExtensionRoutes() {
        this._extRoutes = [];
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
        this._addApiRoutes();
    }

    _addSystemRoutes() {
        var systemRouter = express.Router();

        this._addInfoRoute(systemRouter);
        this._addSessionRoute(systemRouter);
        this._addLogRoute(systemRouter);
        this._addUpdateRoute(systemRouter);
        this._addRestartRoute(systemRouter);
        this._addReloadRoute(systemRouter);
        this._addShutdownRoute(systemRouter);

        this._addAuthRoutes(systemRouter);

        var toolsRouter = express.Router();
        this._addDatabaseRoutes(toolsRouter);
        if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
            var devRouter = express.Router();
            this._addEvalRoute(devRouter);
            this._addFuncRoute(devRouter);
            this._addExecRoute(devRouter);
            this._addEditRoute(devRouter);
            this._addUploadRoute(devRouter);
            toolsRouter.use('/dev', devRouter);
        }
        systemRouter.use('/tools', toolsRouter);

        this._app.use('/sys', systemRouter);
    }

    _addInfoRoute(router) {
        router.get('/info', function (req, res) {
            res.json(this._info);
        }.bind(this._controller));
    }

    _addSessionRoute(router) {
        router.get('/session', function (req, res) {
            var bAuth = (this._config['auth'] == undefined || this._config['auth'] == true);
            var session = { 'auth': bAuth };
            if (bAuth && req.session.user) {
                session['user'] = req.session.user;
            }
            res.json(session);
        }.bind(this));
    }

    _addLogRoute(router) {
        router.get('/log', function (req, res) {
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
    }

    _addUpdateRoute(router) {
        router.get('/update', async function (req, res) {
            var bUpdated = false;
            if (this._vcs) {
                var version;
                if (req.query['v'])
                    version = req.query['v'];
                else if (req.query['version'])
                    version = req.query['version'];
                var bForce = req.query['force'] === 'true';
                var bReset = req.query['reset'] === 'true';
                var bRemove = req.query['rm'] === 'true';
                var msg;
                try {
                    var bUpdate;
                    if (!bForce && this._vcs['client'] === VcsEnum.GIT) {
                        if (version) {
                            var v;
                            if (version === 'latest') {
                                var url = 'https://raw.githubusercontent.com/pb-it/wing-cms-api/main/package.json';
                                var response = await this.getWebClient().curl(url);
                                v = response['version'];
                            } else
                                v = version;

                            var appVersion = this._versionController.getPkgVersion();
                            var sAppVersion = appVersion.toString();
                            if (v !== sAppVersion) {
                                var newVersion = new AppVersion(v);
                                if (newVersion.major > appVersion.major ||
                                    (newVersion.major == appVersion.major && newVersion.minor > appVersion.minor)) {
                                    msg = "An update of the major or minor release version may result in incompatibilitiy problems! Force only after studying changelog!";
                                } else
                                    bUpdate = true;
                            } else {
                                Logger.info("[App] Already up to date");
                                msg = "Already up to date";
                            }
                        } else
                            bUpdate = true;
                    } else
                        bUpdate = true;

                    if (bUpdate) {
                        msg = await this.update(version, bReset, bRemove);
                        console.log(msg);
                        if (msg) {
                            var strUpToDate;
                            if (this._vcs['client'] === VcsEnum.GIT)
                                strUpToDate = 'Already up to date.'; // 'Bereits aktuell.' ... localize
                            else if (this._vcs['client'] === VcsEnum.SVN)
                                strUpToDate = 'Updating \'.\':' + os.EOL + 'At revision';

                            if (msg.startsWith(strUpToDate))
                                Logger.info("[App] Already up to date");
                            else {
                                Logger.info("[App] ✔ Updated");
                                bUpdated = true;
                            }
                        } else
                            throw new Error('Missing response from version control system!');
                    }
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
            } else
                res.send('No version control system detected!');
            if (bUpdated)
                this.restart();
            return Promise.resolve();
        }.bind(this._controller));
    }

    _addRestartRoute(router) {
        router.get('/restart', function (req, res) {
            res.send("Restarting..");
            this.restart();
        }.bind(this._controller));
    }

    _addReloadRoute(router) {
        router.get('/reload', async function (req, res) {
            var bForceMigration = (req.query['forceMigration'] === 'true');
            try {
                if (this._info['state'] === 'openRestartRequest') {
                    res.send("Restarting instead of reloading because of open request.");
                    this.restart();
                } else {
                    var bDone = await this.reload(bForceMigration);
                    if (bDone) {
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
    }

    _addShutdownRoute(router) {
        router.get('/shutdown', (req, res) => {
            res.send("Shutdown initiated");
            process.exit();
        });
    }

    _addDatabaseRoutes(router) {
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
        router.use('/db', dbRouter);
    }

    _addAuthRoutes(router) {
        var authRouter = express.Router();
        authRouter.get('/login', async function (req, res) {
            var result = await renderFile(path.join(this._controller.getAppRoot(), './views/auth/login.ejs'), {});
            res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
            res.end(result);
            return Promise.resolve();
        }.bind(this));
        authRouter.post('/login', express.urlencoded({ extended: false }), async function (req, res, next) {
            var username = req.body.user;
            var password = req.body.pass;
            var user;
            if (username && password)
                user = await this._controller.getAuthController().checkAuthentication(username, password);
            if (user) {
                req.session.regenerate(function (err) {
                    if (err)
                        return next(err);
                    req.session.user = user;
                    req.session.save(function (err) {
                        if (err)
                            return next(err);
                        res.redirect('/');
                    });
                });
            } else {
                var result = await renderFile(path.join(this._controller.getAppRoot(), './views/auth/login.ejs'), { 'error': 'Login failed!' });
                res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
                res.end(result);
            }
            return Promise.resolve();
        }.bind(this));
        authRouter.get('/logout', function (req, res, next) {
            req.session.user = null;
            req.session.save(function (err) {
                if (err)
                    return next(err);
                req.session.regenerate(function (err) {
                    if (err)
                        return next(err);
                    res.redirect('/');
                });
            });
        });
        authRouter.get('/passwd', async function (req, res) {
            var user = req.query['user'];
            if (!user && req.session.user)
                user = req.session.user['username'];
            if (user) {
                var result = await renderFile(path.join(this._controller.getAppRoot(), './views/auth/passwd.ejs'), {});
                res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
                res.end(result);
            } else
                res.redirect('/sys/auth/login');
            return Promise.resolve();
        }.bind(this));
        authRouter.post('/passwd', async function (req, res, next) {
            var error;
            var user = req.query['user'];
            if (!user && req.session.user)
                user = req.session.user['username'];
            var current_password = req.body['current_password'];
            var new_password_1 = req.body['new_password_1'];
            var new_password_2 = req.body['new_password_2'];
            if (user) {
                if (new_password_1.length >= 6) {
                    if (new_password_1 != current_password) {
                        if (new_password_1 == new_password_2) {
                            try {
                                var bDone = await this._controller.getAuthController().changePassword(user, current_password, new_password_1);
                                if (bDone)
                                    res.send('Password changed successfully!');
                            } catch (error) {
                                if (error instanceof AuthError) {
                                    error = error.message;
                                } else {
                                    Logger.parseError(error);
                                    res.status(404);
                                    res.send('Something went wrong!');
                                }
                            }
                        } else
                            error = 'New Password Missmatch!';
                    } else
                        error = 'New Password matches the current one!';
                } else
                    error = 'New Password must at least have 6 digits!';
            } else
                res.redirect('/sys/auth/login');
            if (error) {
                var result = await renderFile(path.join(this._controller.getAppRoot(), './views/auth/passwd.ejs'), { 'error': error });
                res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
                res.end(result);
            }
            if (res.headersSent)
                next();
            return Promise.resolve();
        }.bind(this));
        router.use('/auth', authRouter);
    }

    /**
     * Example:
     *   _eval('module.exports = function () { return 123 }');
     *   NOT: eval('(function() { return 7; }())');
     * https://www.npmjs.com/package/eval
     * @param {*} router 
     */
    _addEvalRoute(router) {
        const evalForm = '<form action="/sys/tools/dev/eval" method="post">' +
            'Command:<br><textarea name="cmd" rows="10" cols="80">async function test() {\n\tawait new Promise(resolve => ' +
            'setTimeout(resolve, 1000));\n\treturn Promise.resolve(\'123\');\n}\n\nmodule.exports = test;</textarea><br>' +
            '<input type="submit" value="Evaluate"></form>';

        router.get('/eval', (req, res) => {
            res.send(evalForm);
        });
        router.post('/eval', async (req, res) => {
            try {
                var cmd = req.body['cmd'];
                if (cmd) {
                    var response;
                    Logger.info("[App] Evaluating command '" + cmd + "'");
                    try {
                        //response = eval(code);
                        var e = _eval(cmd, true);
                        response = await e();
                    } catch (error) {
                        response = error.toString();
                    }
                    var format = req.query['_format'];
                    if (format) {
                        if (format == 'text')
                            res.send(response);
                        else if (format == 'json')
                            res.json({ 'response': response });
                        else
                            throw new Error('Unknown format!');
                    } else {
                        if (response) {
                            if (typeof response === 'string' || response instanceof String)
                                response = response.replaceAll('\n', '<br>');
                        } else
                            response = 'Empty response!'; //'An error occurred while processing your request!'
                        var form = '<form action="/sys/tools/dev/eval" method="post">' +
                            'Command:<br><textarea name="cmd" rows="10" cols="80">' + cmd + '</textarea><br>' +
                            '<input type="submit" value="Evaluate"></form>';
                        res.send(response + '<br>' + form);
                    }
                } else
                    throw new Error('Empty request!');
            } catch (error) {
                if (error && error.message) {
                    res.status(404);
                    res.send(error.message);
                }
            }
            if (!res.headersSent) {
                res.status(500);
                res.send("Something went wrong!");
            }
            return Promise.resolve();
        });
    }

    /**
     * Fails when code contains 'require' function!
     * @param {*} router
     */
    _addFuncRoute(router) {
        const form = '<form action="/sys/tools/dev/func" method="post">' +
            'Command:<br><textarea name="code" rows="4" cols="50"></textarea><br>' +
            '<input type="submit" value="Run"></form>';

        router.get('/func', (req, res) => {
            res.send(form);
        });
        router.post('/func', async (req, res) => {
            try {
                var code = req.body['code'];
                if (code) {
                    var response;
                    Logger.info("[App] Running function '" + code + "'");
                    try {
                        //response = new Function(code)();
                        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                        response = await new AsyncFunction(code)();
                    } catch (error) {
                        response = error.toString();
                    }
                    var format = req.query['_format'];
                    if (format) {
                        if (format == 'text')
                            res.send(response);
                        else if (format == 'json')
                            res.json({ 'response': response });
                        else
                            throw new Error('Unknown format!');
                    } else {
                        if (response) {
                            if (typeof response === 'string' || response instanceof String)
                                response = response.replaceAll('\n', '<br>');
                        } else
                            response = 'Empty response!'; //'An error occurred while processing your request!'
                        res.send(response + '<br><br>' + form);
                    }
                } else
                    throw new Error('Empty request!');
            } catch (error) {
                if (error && error.message) {
                    res.status(404);
                    res.send(error.message);
                }
            }
            if (!res.headersSent) {
                res.status(500);
                res.send("Something went wrong!");
            }
            return Promise.resolve();
        });
    }

    _addExecRoute(router) {
        const execForm = '<form action="/sys/tools/dev/exec" method="post">' +
            'Command:<br><textarea name="cmd" rows="4" cols="50"></textarea><br>' +
            '<input type="submit" value="Execute"></form>';

        router.get('/exec', (req, res) => {
            res.send(execForm);
        });
        router.post('/exec', async (req, res) => {
            try {
                var cmd = req.body['cmd'];
                if (cmd) {
                    var response;
                    Logger.info("[App] Executing command '" + cmd + "'");
                    try {
                        response = await common.exec(cmd);
                    } catch (error) {
                        response = error.toString();
                    }
                    var format = req.query['_format'];
                    if (format) {
                        if (format == 'text')
                            res.send(response);
                        else if (format == 'json')
                            res.json({ 'response': response });
                        else
                            throw new Error('Unknown format!');
                    } else {
                        if (response) {
                            if (typeof response === 'string' || response instanceof String)
                                response = response.replaceAll('\n', '<br>');
                        } else
                            response = 'Empty response!'; //'An error occurred while processing your request!'
                        res.send(response + '<br>' + execForm);
                    }
                } else
                    throw new Error('Empty request!');
            } catch (error) {
                if (error && error.message) {
                    res.status(404);
                    res.send(error.message);
                }
            }
            if (!res.headersSent) {
                res.status(500);
                res.send("Something went wrong!");
            }
            return Promise.resolve();
        });
    }

    _addEditRoute(router) {
        router.get('/edit', (req, res) => {
            var response;
            try {
                var file = req.query['file'];
                if (file && fs.existsSync(file)) {
                    var text = fs.readFileSync(file, 'utf8');
                    response = '<form action="/sys/tools/dev/edit" method="post">' +
                        'File:<br><input name="file" value="' + file + '"></input><br>' +
                        'Text:<br><textarea name="text" rows="10" cols="50">' + text + '</textarea>' +
                        '<input type="submit" value="Save"></form>';
                } else {
                    if (file)
                        response = 'File \'' + file + '\' does not exist!<br>';
                    else
                        response = '';
                    response += '<form action="/sys/tools/dev/edit" method="get">' +
                        'File:<br><input name="file"></input><br>' +
                        '<input type="submit" value="Open"></form>'
                }
            } catch (error) {
                response = error.toString();
            }
            res.send(response);
        });
        router.post('/edit', async (req, res) => {
            var file = req.body['file'];
            var text = req.body['text'];
            var response;
            if (file && text) {
                if (fs.existsSync(file)) {
                    try {
                        fs.writeFileSync(file, text);
                        response = 'Saved';
                    } catch (error) {
                        response = error.toString();
                    }
                } else
                    response = 'File \'' + file + '\' does not exist!<br>';
            }
            res.send(response);
            return Promise.resolve();
        });
    }

    _addUploadRoute(router) {
        const uploadForm = '<form action="/sys/tools/dev/upload" enctype="multipart/form-data" method="post">' +
            'File:<br><input type="file" name="file" accept="application/zip"/><br>' +
            '<input type="submit" value="Upload"></form>';

        router.get('/upload', (req, res) => {
            res.send(uploadForm);
        });
        router.post('/upload', async (req, res) => {
            var response;
            var file;
            if (req.files)
                file = req.files['file'];
            if (file) {
                Logger.info("[App] Processing upload");
                try {
                    //var tmpDir = this._controller.getTmpDir();
                    await WebServer._unzipFile(file['path'], this._controller.getAppRoot());
                    response = 'Uploaded';
                } catch (error) {
                    response = error.toString();
                }
            } else
                response = 'Missing file!';
            res.send(response);
            return Promise.resolve();
        });
    }

    _addApiRoutes() {
        var apiRouter = express.Router();

        this._addDataRoute(apiRouter);
        this._addExtensionRoute(apiRouter);

        this._app.use('/api', apiRouter);
    }

    _addDataRoute(router) {
        var dataRouter = express.Router();
        dataRouter.route('*')
            .all(async function (req, res, next) {
                var bSent = false;

                var timeout;
                if (this._config && this._config['api'])
                    timeout = this._config['api']['timeout'];
                if (timeout > 0) {
                    if (this._svr.timeout < timeout) {
                        res.setTimeout(timeout, function (socket) {
                            var msg = 'Response Processing Timed Out.';
                            console.error(msg);
                            res.status(500).send(msg);
                            bSent = true;
                            //socket.destroy();
                        });
                    }
                }

                try {
                    var route = await this.getMatchingCustomRoute(req);
                    if (route)
                        await route['fn'](req, res, next);
                    else
                        await this._controller.processRequest(req, res);
                    bSent = true;
                } catch (error) {
                    var msg = Logger.parseError(error);
                    if (error && !res.headersSent) {
                        if (error instanceof ValidationError || error instanceof ExtensionError) {
                            //res.status(400); // Bad Request
                            //res.status(404);
                            //res.status(409); // Conflict
                            res.status(422); // Unprocessable Entity
                            res.send(error.message);
                        } else if (error.message && error.message === "EmptyResponse") {
                            res.status(404);
                            res.send(error.message);
                        } else {
                            res.status(500);
                            res.send(msg);
                        }
                        bSent = true;
                    }
                }
                if (!bSent && !res.headersSent)
                    next();
                return Promise.resolve();
            }.bind(this));
        router.use('/data/' + this._apiVersion, dataRouter);
    }

    _addExtensionRoute(router) {
        router.use('/ext', async function (req, res, next) {
            var bSent = false;
            var r;
            for (var route of this._extRoutes) {
                if (route['regex'] && route['fn']) {
                    var match = new RegExp(route['regex'], 'ig').exec(req.path);
                    if (match) {
                        if (!req.locals)
                            req.locals = { 'match': match };
                        else
                            req.locals['match'] = match;
                        r = route;
                        break;
                    }
                }
            }
            if (r) {
                await r['fn'](req, res, next);
                bSent = true;
            } else
                next(); // res.send('Unknown extension');
            if (!bSent && !res.headersSent)
                next();
            return Promise.resolve();
        }.bind(this));
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

    async getMatchingCustomRoute(req) {
        //console.log(req.path); // originalUrl = baseUrl + path; url = path with query; baseUrl = /api/data/v1
        var res;
        for (var route of this._routes) {
            if (route['regex'] && route['fn']) {
                var match = new RegExp(route['regex'], 'ig').exec(req.path);
                if (match) {
                    if (!req.locals)
                        req.locals = { 'match': match };
                    else
                        req.locals['match'] = match;
                    res = route;
                    break;
                }
            }
        }
        return Promise.resolve(res);
    }
}

module.exports = WebServer;