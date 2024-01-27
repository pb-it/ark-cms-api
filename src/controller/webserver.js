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
const { AuthError } = require('./auth-controller');
const { ExtensionError } = require('./extension-controller');
const AppVersion = require('../common/app-version');

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
        if (this._controller.getAuthController())
            app.use(session(sessOptions));

        app.use(express.urlencoded({ limit: '100mb', extended: true }));
        app.use(express.json({ limit: '100mb' }));
        app.use(formData.parse());

        app.get('/robots.txt', function (req, res) {
            res.type('text/plain');
            res.send("User-agent: *\nDisallow: /");
        });

        return app;
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

    addCustomDataRoute(route) {
        if (route['regex'] && route['fn']) {
            this.deleteCustomDataRoute(route);
            this._routes.push(route);
        }
    }

    deleteCustomDataRoute(route) {
        if (route['regex']) {
            this._routes = this._routes.filter(function (x) {
                return (x['regex'] !== route['regex']);
            });
        }
    }

    deleteAllCustomDataRoutes() {
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
        this._addCdnRoutes();
        this._addRootRoute();
        this._addSystemRoutes();
        this._addApiRoutes();
    }

    _addCdnRoutes() {
        if (this._config['fileStorage']) {
            var root;
            var filePath;
            for (var storage of this._config['fileStorage']) {
                if (storage['url'] && storage['path']) {
                    root = null;
                    filePath = null;
                    if (storage['path'].startsWith('/'))
                        root = storage['path'];
                    else if (storage['path'].startsWith('.'))
                        root = path.join(this._controller.getAppRoot(), storage['path']);
                    if (root && fs.existsSync(root)) {
                        this._app.get(storage['url'] + '/*', function (req, res, next) {
                            var status;
                            if (this._controller.getAuthController()) {
                                if (!req.session.user)
                                    status = 401; //Unauthorized
                            }
                            if (status)
                                res.sendStatus(status);
                            else {
                                filePath = path.join(root, req.path.substring(storage['url'].length));
                                if (fs.existsSync(filePath))
                                    res.sendFile(filePath);
                                else
                                    next();
                            }
                        }.bind(this));
                    } else
                        Logger.error("[App] ✘ File Storage '" + storage['path'] + "' not found");
                }
            }
        }
    }

    _addRootRoute() {
        this._app.get('/', function (req, res) {
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    res.send('Hello, ' + req.session.user.username + '!' +
                        ' <a href="/sys/auth/logout">Logout</a>');
                } else
                    res.redirect('/sys/auth/login');
            } else
                res.send('Hello!');
        }.bind(this));
    }

    _addSystemRoutes() {
        const systemRouter = express.Router();

        this._addInfoRoute(systemRouter);
        this._addLogRoute(systemRouter);
        this._addUpdateRoute(systemRouter);
        this._addRestartRoute(systemRouter);
        this._addReloadRoute(systemRouter);
        this._addShutdownRoute(systemRouter);

        if (this._controller.getAuthController()) {
            this._addAuthRoutes(systemRouter);
            this._addSessionRoute(systemRouter);
        }

        const toolsRouter = express.Router();
        this._addDatabaseRoutes(toolsRouter);
        if (!process.env.NODE_ENV || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
            const devRouter = express.Router();
            this._addEvalRoute(devRouter);
            this._addFuncRoute(devRouter);
            this._addExecRoute(devRouter);
            this._addEditRoute(devRouter);
            this._addPatchRoute(devRouter);
            toolsRouter.use('/dev', devRouter);
        }
        systemRouter.use('/tools', toolsRouter);

        this._app.use('/sys', systemRouter);
    }

    _addInfoRoute(router) {
        router.get('/info', function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (!req.session.user)
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                const info = this._controller.getInfo();
                info['time'] = new Date().toISOString();
                res.json(info);
            }
        }.bind(this));
    }

    _addLogRoute(router) {
        router.get('/log', function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
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
            }
        }.bind(this));
    }

    _addUpdateRoute(router) {
        router.get('/update', async function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                var bUpdated = false;
                if (this._controller._vcs) {
                    const client = this._controller._vcs['client'];
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
                        if (!bForce && client === VcsEnum.GIT) {
                            if (version) {
                                var v;
                                if (version === 'latest') {
                                    var url = 'https://raw.githubusercontent.com/pb-it/ark-cms-api/main/package.json';
                                    var response = await this._controller.getWebClientController().getWebClient().get(url);
                                    v = response['version'];
                                } else
                                    v = version;

                                var appVersion = this._controller.getVersionController().getPkgVersion();
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
                            msg = await this._controller.update(version, bReset, bRemove);
                            console.log(msg);
                            if (msg) {
                                var strUpToDate;
                                if (client === VcsEnum.GIT)
                                    strUpToDate = 'Already up to date.'; // 'Bereits aktuell.' ... localize
                                else if (client === VcsEnum.SVN)
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
                    this._controller.restart();
            }
            return Promise.resolve();
        }.bind(this));
    }

    _addRestartRoute(router) {
        router.get('/restart', function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                res.send("Restarting..");
                this._controller.restart();
            }
        }.bind(this));
    }

    _addReloadRoute(router) {
        router.get('/reload', async function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                var bForceMigration = (req.query['forceMigration'] === 'true');
                try {
                    if (this._controller.getInfo()['state'] === 'openRestartRequest') {
                        res.send("Restarting instead of reloading because of open request.");
                        this.restart();
                    } else {
                        var bDone = await this._controller.reload(bForceMigration);
                        if (bDone) {
                            var msg = "Reload done.";

                            if (this._controller.getInfo()['state'] === 'openRestartRequest') {
                                res.send(msg + " Restarting now.");
                                this._controller.restart();
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
            }
            return Promise.resolve();
        }.bind(this));
    }

    _addShutdownRoute(router) {
        router.get('/shutdown', function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                res.send("Shutdown initiated");
                process.exit();
            }
        }.bind(this));
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
                res.writeHead(401, { 'Content-Type': 'text/html;charset=utf-8' });
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

    _addSessionRoute(router) {
        router.get('/session', function (req, res) {
            var status;
            if (!req.session.user)
                status = 401; //Unauthorized
            if (status)
                res.sendStatus(status);
            else {
                const session = {
                    'auth': true,
                    'user': req.session.user
                };
                res.json(session);
            }
        }.bind(this));
    }

    _addDatabaseRoutes(router) {
        var dbRouter = express.Router();
        dbRouter.get('/backup', async function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                var bSent;
                try {
                    const settings = this._controller.getDatabaseSettings();
                    if (settings && settings['client'].startsWith('mysql')) {
                        var file;
                        file = this._controller.getTmpDir() + "/" + settings['connection']['database'] + "_" + createDateTimeString() + ".sql";
                        var cmd;
                        if (process.platform === 'linux')
                            cmd = 'mysqldump';
                        else if (process.platform === 'win32')
                            cmd = 'mysqldump.exe';
                        else
                            throw new Error(`Unsupported Platform: '${process.platform}'`);
                        var bRemote;
                        if (settings['connection']['host'] !== 'localhost' && settings['connection']['host'] !== '127.0.0.1') {
                            bRemote = true;
                            cmd += ' --host=' + settings['connection']['host'];
                        }
                        if (settings['connection'].hasOwnProperty('port') && settings['connection']['port'] !== '3306')
                            cmd += ' --port=' + settings['connection']['port'];
                        if (bRemote)
                            cmd += ' --protocol=tcp';
                        cmd += ' --verbose --user=' + settings['connection']['user'];
                        var password;
                        if (req.query['password'])
                            password = req.query['password'];
                        else
                            password = settings['connection']['password'];
                        if (password)
                            cmd += ' --password=' + password;
                        cmd += ` --single-transaction=TRUE --skip-lock-tables --add-drop-database --opt --skip-set-charset --default-character-set=utf8mb4 --databases cms > ${file}`;
                        // --column-statistics=0 --skip-triggers
                        Logger.info("[App] Creating database dump to '" + file + "'");
                        await common.exec(cmd);
                        if (file) {
                            res.download(file);
                            bSent = true;
                        } else
                            throw new Error('An unexpected error has occurred');
                    } else
                        throw new Error('By now backup/restore API is only supports MySQL databases!');
                } catch (error) {
                    Logger.parseError(error);
                    if (error) {
                        res.status(500);
                        if (error['message'])
                            res.send(error['message']);
                        else
                            res.send(error.toString());
                    }
                }
                if (!bSent && !res.headersSent) {
                    res.status(500); // Internal Server Error
                    res.send('An unexpected error has occurred');
                }
            }
            return Promise.resolve();
        }.bind(this));

        dbRouter.get('/restore', function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                const settings = this._controller.getDatabaseSettings();
                if ((process.platform === 'linux' || process.platform === 'win32') && settings && settings['client'].startsWith('mysql')) {
                    const form = '<form action="/sys/tools/db/restore" enctype="multipart/form-data" method="post">' +
                        'File:<br><input type="file" name="file" accept="application/sql"/><br>' + // accept="application/zip"
                        '<input type="submit" value="Restore"></form>';
                    res.send(form);
                } else
                    res.send('By now backup/restore API is only supports MySQL databases!');
            }
        }.bind(this));

        dbRouter.post('/restore', async function (req, res) {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                try {
                    var response;
                    const settings = this._controller.getDatabaseSettings();
                    if (settings && settings['client'].startsWith('mysql')) {
                        var file;
                        if (req.files)
                            file = req.files['file'];
                        if (file && file['path']) {
                            if (file['type'] === 'application/sql' || file['type'] === 'application/octet-stream') {
                                var cmd;
                                if (process.platform === 'linux')
                                    cmd = 'mysql';
                                else if (process.platform === 'win32')
                                    cmd = 'mysql.exe';
                                else
                                    throw new Error(`Unsupported Platform: '${process.platform}'`);
                                var bRemote;
                                if (settings['connection']['host'] !== 'localhost' && settings['connection']['host'] !== '127.0.0.1') {
                                    bRemote = true;
                                    cmd += ' --host=' + settings['connection']['host'];
                                }
                                if (settings['connection'].hasOwnProperty('port') && settings['connection']['port'] !== '3306')
                                    cmd += ' --port=' + settings['connection']['port'];
                                if (bRemote)
                                    cmd += ' --protocol=tcp';
                                cmd += ' --verbose --user=' + settings['connection']['user'];
                                var password;
                                if (req.query['password'])
                                    password = req.query['password'];
                                else
                                    password = settings['connection']['password'];
                                if (password)
                                    cmd += ' --password=' + password;
                                cmd += '< ' + file['path'];
                                // --comments
                                Logger.info("[App] Restoring Database");
                                await common.exec(cmd);
                                fs.unlinkSync(file['path']);
                                response = 'Restored';
                            } else
                                throw new Error(`Unprocessable File Type: '${file['type']}'`);
                        } else
                            throw new Error('Missing File');
                    } else
                        throw new Error('By now backup/restore API is only supports MySQL databases!');
                    res.send(response);
                } catch (error) {
                    Logger.parseError(error);
                    if (error) {
                        res.status(500);
                        if (error['message'])
                            res.send(error['message']);
                        else
                            res.send(error.toString());
                    }
                }
                if (!res.headersSent) {
                    res.status(500); // Internal Server Error
                    res.send('An unexpected error has occurred');
                }
            }
            return Promise.resolve();
        }.bind(this));
        router.use('/db', dbRouter);
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
            'Command:<br><textarea name="cmd" rows="10" cols="80">' +
            `// https://www.npmjs.com/package/eval
async function test() {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return Promise.resolve(\'123\');
};

module.exports = test;` +
            '</textarea><br>' +
            '<input type="submit" value="Evaluate"></form>';

        router.get('/eval', (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else
                res.send(evalForm);
        });
        router.post('/eval', async (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                try {
                    var cmd = req.body['cmd'];
                    if (cmd) {
                        var response;
                        var type;
                        if (req.query)
                            type = req.query['type'];
                        if (!type || type === 'module') {
                            Logger.info("[App] Evaluating command '" + cmd + "'");
                            try {
                                //response = eval(code);
                                var e = _eval(cmd, true);
                                if (typeof e === 'function') // e instanceof Function
                                    response = await e();
                                else if (typeof e === 'object')
                                    response = JSON.stringify(e);
                                else
                                    throw new Error('Evaluation failed!');
                            } catch (error) {
                                Logger.parseError(error);
                                response = error.toString();
                            }
                        } else
                            throw new Error('Input type not supported!');
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
                    } else {
                        res.status(400); // Bad Request / 422 (Unprocessable Entity)
                        res.send('Empty request');
                    }
                } catch (error) {
                    Logger.parseError(error);
                    if (error && error['message']) {
                        res.status(500);
                        res.send(error['message']);
                    }
                }
                if (!res.headersSent) {
                    res.status(500); // Internal Server Error
                    res.send('An unexpected error has occurred');
                }
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
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else
                res.send(form);
        });
        router.post('/func', async (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
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
                    } else {
                        res.status(400); // Bad Request / 422 (Unprocessable Entity)
                        res.send('Empty request');
                    }
                } catch (error) {
                    Logger.parseError(error);
                    if (error && error['message']) {
                        res.status(500);
                        res.send(error['message']);
                    }
                }
                if (!res.headersSent) {
                    res.status(500); // Internal Server Error
                    res.send('An unexpected error has occurred');
                }
            }
            return Promise.resolve();
        });
    }

    _addExecRoute(router) {
        const execForm = '<form action="/sys/tools/dev/exec" method="post">' +
            'Command:<br><textarea name="cmd" rows="4" cols="50"></textarea><br>' +
            '<input type="submit" value="Execute"></form>';

        router.get('/exec', (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else
                res.send(execForm);
        });
        router.post('/exec', async (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
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
                    } else {
                        res.status(400); // Bad Request / 422 (Unprocessable Entity)
                        res.send('Empty request');
                    }
                } catch (error) {
                    Logger.parseError(error);
                    if (error && error['message']) {
                        res.status(500);
                        res.send(error['message']);
                    }
                }
                if (!res.headersSent) {
                    res.status(500); // Internal Server Error
                    res.send('An unexpected error has occurred');
                }
            }
            return Promise.resolve();
        });
    }

    _addEditRoute(router) {
        router.get('/edit', (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                try {
                    var response;
                    var file = req.query['file'];
                    var p;
                    if (file) {
                        if (process.platform === 'linux') {
                            if (file.startsWith('/'))
                                p = file;
                            else
                                p = path.join(this._controller.getAppRoot(), file);
                        } else {
                            if (file.startsWith('.'))
                                p = path.join(this._controller.getAppRoot(), file);
                            else
                                p = file;
                        }
                    }
                    if (file && fs.existsSync(p)) {
                        var text = fs.readFileSync(p, 'utf8');
                        response = '<form action="/sys/tools/dev/edit" method="post">' +
                            'File:<br><input name="file" value="' + file + '"></input><br>' +
                            'Text:<br><textarea name="text" rows="10" cols="50">' +
                            text.replace(/[\u00A0-\u9999<>\&]/g, function (i) {
                                return '&#' + i.charCodeAt(0) + ';';
                            }) +
                            '</textarea><input type="submit" value="Save"></form>';
                    } else {
                        if (file)
                            response = 'File \'' + file + '\' does not exist!<br>';
                        else
                            response = '';
                        response += '<form action="/sys/tools/dev/edit" method="get">' +
                            'File:<br><input name="file"></input><br>' +
                            '<input type="submit" value="Open"></form>'
                    }
                    res.send(response);
                } catch (error) {
                    Logger.parseError(error);
                    if (error) {
                        res.status(500);
                        if (error['message'])
                            res.send(error['message']);
                        else
                            res.send(error.toString());
                    }
                }
                if (!res.headersSent) {
                    res.status(500); // Internal Server Error
                    res.send('An unexpected error has occurred');
                }
            }
            return Promise.resolve();
        });
        router.post('/edit', async (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                var file = req.body['file'];
                var text = req.body['text'];
                var response;
                if (file && text) {
                    var p;
                    if (process.platform === 'linux') {
                        if (file.startsWith('/'))
                            p = file;
                        else
                            p = path.join(this._controller.getAppRoot(), file);
                    } else {
                        if (file.startsWith('.'))
                            p = path.join(this._controller.getAppRoot(), file);
                        else
                            p = file;
                    }
                    if (fs.existsSync(p)) {
                        try {
                            fs.writeFileSync(p, text);
                            response = 'Saved';
                        } catch (error) {
                            response = error.toString();
                        }
                    } else
                        response = 'File \'' + file + '\' does not exist!<br>';
                }
                res.send(response);
            }
            return Promise.resolve();
        });
    }

    _addPatchRoute(router) {
        const uploadForm = '<form action="/sys/tools/dev/patch" enctype="multipart/form-data" method="post">' +
            'File:<br><input type="file" name="file" accept="application/zip"/><br>' +
            '<input type="submit" value="Patch"></form>';

        router.get('/patch', (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else
                res.send(uploadForm);
        });
        router.post('/patch', async (req, res) => {
            var status;
            if (this._controller.getAuthController()) {
                if (req.session.user) {
                    if (!req.session.user.roles.includes('administrator'))
                        status = 403; //Forbidden
                } else
                    status = 401; //Unauthorized
            }
            if (status)
                res.sendStatus(status);
            else {
                var response;
                var file;
                if (req.files)
                    file = req.files['file'];
                if (file) {
                    Logger.info("[App] Processing patch");
                    try {
                        //var tmpDir = this._controller.getTmpDir();
                        await WebServer._unzipFile(file['path'], this._controller.getAppRoot());
                        response = 'Patched';
                    } catch (error) {
                        Logger.parseError(error);
                        res.status(500);
                        response = error.toString();
                    }
                } else
                    response = 'Missing file!';
                res.send(response);
            }
            return Promise.resolve();
        });
    }

    _addApiRoutes() {
        const apiRouter = express.Router();

        this._addDataRoute(apiRouter);
        this._addExtensionRoute(apiRouter);

        this._app.use('/api', apiRouter);
    }

    _addDataRoute(router) {
        const dataRouter = express.Router();
        dataRouter.route('*')
            .all(async function (req, res, next) {
                try {
                    var status;
                    var model;
                    const arr = req.path.split('/');
                    if (arr.length >= 2)
                        model = controller.getShelf().getModel(arr[1]);

                    if (model) {
                        if (!model.getDefinition()['public'] || !req.method === 'GET') {
                            const ac = this._controller.getAuthController();
                            if (ac) {
                                if (req.session.user) {
                                    if (!req.session.user.roles.includes('administrator')) {
                                        if (!await ac.hasPermission(req.session.user, model, (req.method === 'GET') ? 1 : 2))
                                            status = 403; //Forbidden
                                    }
                                } else
                                    status = 401; //Unauthorized
                            }
                        }
                    }

                    if (status)
                        res.sendStatus(status);
                    else {
                        var timeout;
                        if (this._config && this._config['api'])
                            timeout = this._config['api']['timeout'];
                        if (timeout > 0) {
                            if (this._svr.timeout < timeout) {
                                res.setTimeout(timeout, function (socket) {
                                    const msg = '[Express] Response Processing Timed Out';
                                    console.error(msg);
                                    res.sendStatus(504); //Gateway Timeout
                                    //socket.destroy();
                                });
                            }
                        }

                        const route = await this.getMatchingCustomRoute(req);
                        if (route)
                            await route['fn'](req, res, next);
                        else if (model)
                            await this._controller.processRequest(req, res);
                    }
                } catch (error) {
                    const msg = Logger.parseError(error);
                    if (error && !res.headersSent) {
                        if (error instanceof ValidationError || error instanceof ExtensionError) {
                            //400 - Bad Request
                            //404 - Not Found
                            //409 - Conflict
                            res.status(422).send(error.message); // Unprocessable Entity
                        } else if (error.message && error.message === "EmptyResponse")
                            res.status(404).send(error.message);
                        else
                            res.status(500).send(msg);
                    }
                } finally {
                    if (!res.headersSent)
                        res.sendStatus(404);
                }
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
                try {
                    await r['fn'](req, res, next);
                } catch (error) {
                    Logger.parseError(error);
                    res.status(500); // Internal Server Error
                    res.send('An unexpected error has occurred');
                }
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
                const id = setTimeout(function () {
                    throw new Error('[Express] ✘ Could not close connections in time, forcefully shutting down');
                }, 10000);
                this._svr.close(function (err) {
                    clearTimeout(id);
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            } else
                resolve();
        }.bind(this));
    }

    /**
     * req.originalUrl = '/api/data/v1/<model>/...'
     * req.baseUrl = '/api/data/v1'
     * req.path = '/<model>/...'
     * req.params = [ '/<model>/...' ]
     * @param {*} req 
     * @returns 
     */
    async getMatchingCustomRoute(req) {
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