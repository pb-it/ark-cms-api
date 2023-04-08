const path = require('path');
const fs = require('fs');
const unzipper = require("unzipper");
const { Duplex } = require('stream');

const Logger = require('../common/logger/logger');
const AppVersion = require('../common/app-version');
const MigrationController = require('./migration-controller');

class ExtensionError extends Error {
    constructor(message) {
        super(message);
        this.name = "ExtensionError";
    }
}

class ExtensionController {

    static _bufferToStream(buffer) {
        var stream = new Duplex();
        stream.push(buffer);
        stream.push(null);
        return stream;
    }

    static async _unzipStream(stream, target) {
        var dir;
        return new Promise((resolve, reject) => {
            stream.pipe(unzipper.Parse())
                .on('entry', function (entry) {
                    if (entry.type == 'Directory') {
                        if (!dir)
                            dir = path.basename(entry.path);
                        fs.mkdirSync(path.join(target, entry.path), { recursive: true });
                    } else
                        entry.pipe(fs.createWriteStream(path.join(target, entry.path)));
                })
                .promise()
                .then(() => resolve(dir), e => reject(e));
        });
    }

    _controller;
    _model;
    _dir;
    _extensions;

    constructor(controller) {
        this._controller = controller;
        this._dir = path.join(this._controller.getAppRoot(), 'extensions');
    }

    async initExtensionController() {
        var shelf = this._controller.getShelf();
        this._model = shelf.getModel('_extension');
        if (!this._model) {
            var definition = {
                "name": "_extension",
                "options": {
                    "increments": true,
                    "timestamps": true
                },
                "attributes": [
                    {
                        "name": "name",
                        "dataType": "string",
                        "required": true,
                        "unique": "true"
                    },
                    {
                        "name": "archive",
                        "dataType": "file",
                        "storage": "blob",
                        "hidden": true
                    },
                    {
                        "name": "client-extension",
                        "dataType": "text"
                    }
                ],
                "defaults": {
                    "title": "name",
                    "view": {
                        "details": "title"
                    }
                }
            }
            //var model = new Model(shelf, null, definition);
            this._model = await shelf.upsertModel(null, definition);
        }
        if (!this._model.initDone())
            await this._model.initModel();

        await this.loadAllExtensions();

        return Promise.resolve();
    }

    async loadAllExtensions(bClean) {
        this._extensions = [];
        if (bClean) {
            var p;
            var stat;
            for (const item of fs.readdirSync(this._dir)) {
                p = path.join(this._dir, item);
                stat = fs.statSync(p);
                if (stat.isDirectory())
                    fs.rmSync(p, { recursive: true, force: true });
            }
        }
        //const entries = await fs.promises.readdir(this._dir);
        var data = await this._model.readAll();
        for (var meta of data) {
            await this._loadExtension(meta);
        }
        return Promise.resolve();
    }

    async _loadExtension(meta, bSetup, bOverride) {
        var bLoaded = false;
        var ext;
        var name = meta['name'];
        var module;
        try {
            var p = path.join(this._dir, name);
            var bExist = fs.existsSync(p);
            if (!bExist || bOverride) {
                var tmpDir = this._controller.getTmpDir();
                var folderName = await ExtensionController._unzipStream(ExtensionController._bufferToStream(meta['archive']), tmpDir);
                var source = path.join(tmpDir, folderName);
                if (bExist)
                    fs.rmSync(p, { recursive: true, force: true });
                //fs.renameSync(source, p); // fs.rename fails if two separate partitions are involved
                fs.cpSync(source, p, { recursive: true, force: true });
                fs.rmSync(source, { recursive: true, force: true });
            }
            var stat = fs.statSync(p);
            if (stat.isDirectory()) {
                var manifest = path.join(p, 'manifest.json');
                if (fs.existsSync(manifest)) {
                    var str = fs.readFileSync(manifest, 'utf8');
                    if (str.length > 0) {
                        var json = JSON.parse(str);
                        this._checkVersionCompatibility(json);
                        var npmDependencies = json['npm_dependencies'];
                        if (npmDependencies && Object.keys(npmDependencies).length > 0) {
                            var arr = [];
                            for (let [key, value] of Object.entries(npmDependencies)) {
                                if (value)
                                    arr.push(`${key}@${value}`);
                                else
                                    arr.push(key);
                            }
                            await controller.getDependencyController().installDependencies(arr);
                        }
                    }
                }
                /*if (bSetup) {
                    var client = path.join(p, 'client.js');
                    if (fs.existsSync(client))
                        meta['client-extension'] = fs.readFileSync(client, 'utf8');
                }*/
                var index = path.join(p, 'index.js');
                if (fs.existsSync(index)) {
                    var resolved = require.resolve(index);
                    if (resolved)
                        delete require.cache[resolved];
                    try {
                        module = require(index);
                        if (module) {
                            if (module.init)
                                await module.init();
                            if (module.setup && bSetup) {
                                var data = await module.setup();
                                if (data['client-extension'])
                                    meta['client-extension'] = data['client-extension'];
                            }
                        }
                        bLoaded = true;
                    } catch (error) {
                        Logger.parseError(error);
                        /*if (error['code'] == 'MODULE_NOT_FOUND') {
                            console.log(this._controller.getState());
                        } else
                            throw error;*/
                    }
                }
            }
        } catch (error) {
            if (error instanceof ExtensionError) {
                Logger.info("[ExtensionController] ✘ " + error.message);
            } else {
                Logger.parseError(error);
            }
        }
        if (bLoaded) {
            ext = { 'name': name };
            if (module)
                ext['module'] = module;
            this._extensions = this._extensions.filter(function (x) { return x['name'] != name });
            this._extensions.push(ext);
            Logger.info("[ExtensionController] ✔ Loaded extension '" + name + "'");
        } else
            Logger.info("[ExtensionController] ✘ Loading extension '" + name + "' failed");
        return Promise.resolve();
    }

    _checkVersionCompatibility(json) {
        var version = json['app_version'];
        if (version) {
            if (version.startsWith('^')) {
                var appVersion = this._controller.getVersionController().getPkgVersion();
                var reqVersion = new AppVersion(version.substring(1));
                if (appVersion.isLower(reqVersion))
                    throw new ExtensionError('Application version does not meet the extension requirements! App: ' + appVersion.toString() + ', Extension: ' + version);
            }
        }
        return true;
    }

    async addExtension(req) {
        var meta;
        if (req.files && req.files['extension']) { // req.fields
            var file = req.files['extension'];
            if (file['type'] == 'application/zip') {
                var tmpDir = this._controller.getTmpDir();
                var extName = await ExtensionController._unzipStream(fs.createReadStream(file['path']), tmpDir);
                if (extName) {
                    var source = path.join(tmpDir, extName);
                    var manifest = path.join(source, 'manifest.json');
                    if (fs.existsSync(manifest)) {
                        var str = fs.readFileSync(manifest, 'utf8');
                        if (str.length > 0) {
                            var json = JSON.parse(str);
                            this._checkVersionCompatibility(json);
                        }
                    }
                    var target = path.join(this._dir, extName);
                    if (req.method === "PUT" && fs.existsSync(target))
                        fs.rmSync(target, { recursive: true, force: true });
                    //fs.renameSync(source, target); // fs.rename fails if two separate partitions are involved
                    fs.cpSync(source, target, { recursive: true });
                    fs.rmSync(source, { recursive: true, force: true });
                    meta = {};
                    meta['name'] = extName;
                    meta['archive'] = { 'blob': fs.readFileSync(file['path']) };
                    await this._loadExtension(meta, true);
                    if (req.method === "PUT") {
                        var parts = req.originalUrl.split('/');
                        if (parts.length == 5) {
                            delete meta['name'];
                            meta = await this._model.update(parseInt(parts[4]), meta);
                        } else
                            throw new Error('Invalid extension ID');
                    } else
                        meta = await this._model.create(meta);
                }
            }
        }
        return Promise.resolve(meta);
    }

    async deleteExtension(id) {
        var name;
        var data = await this._model.delete(id);
        if (data) {
            name = data['name'];
            if (name) {
                var p = path.join(this._dir, name);
                if (fs.existsSync(p))
                    fs.rmSync(p, { recursive: true, force: true });
                this._extensions = this._extensions.filter(function (x) { return x['name'] != name });
            }
        }
        return Promise.resolve(name);
    }

    getExtension(name) {
        var ext;
        var data = this._extensions.filter(function (x) { return x['name'] == name });
        if (data && data.length == 1)
            ext = data[0];
        return ext;
    }
}

module.exports = { ExtensionController, ExtensionError };