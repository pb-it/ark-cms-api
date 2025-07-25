const path = require('path');
const fs = require('fs');
const unzipper = require("unzipper");
const { Duplex } = require('stream');

const Logger = require('../common/logger/logger');
const AppVersion = require('../common/app-version');

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

    _bSkipLoadingAfterRestartRequest = false;

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
                        "length": 16777216,
                        "hidden": true
                    },
                    {
                        "name": "client-extension",
                        "dataType": "text"
                    },
                    {
                        "name": "configuration",
                        "dataType": "json"
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
            const ac = this._controller.getAuthController();
            if (ac)
                await ac.addDefaultPermission(this._model);
        }
        if (!this._model.initDone())
            await this._model.initModel();

        await this.loadAllExtensions();

        return Promise.resolve();
    }

    async loadAllExtensions(bClean) {
        this._extensions = [];

        if (bClean)
            await this.clearExtensionsDirectory();

        var data = await this._model.readAll();
        for (var meta of data) {
            if (!this.getExtension(meta['name']))
                await this._loadExtension(meta);
        }

        var p;
        var stat;
        for (const item of fs.readdirSync(this._dir)) {
            try {
                p = path.join(this._dir, item);
                stat = fs.statSync(p);
                if (stat.isFile(p) && path.extname(p) == '.zip') {
                    p = path.join(this._dir, item);
                    data = await this._addExtension(p);
                    if (data && data['id']) {
                        Logger.info("[App] ✔ Added extension '" + data['name'] + "'");
                        fs.rmSync(p);
                    }
                }
            } catch (error) {
                if (error instanceof ExtensionError) {
                    Logger.info("[ExtensionController] ✘ " + error.message);
                } else {
                    Logger.parseError(error);
                }
            }
        }
        return Promise.resolve();
    }

    async clearExtensionsDirectory() {
        var p;
        var stat;
        for (var item of fs.readdirSync(this._dir)) {
            p = path.join(this._dir, item);
            stat = fs.statSync(p);
            if (stat.isDirectory())
                fs.rmSync(p, { recursive: true, force: true });
        }
        return Promise.resolve();
    }

    async _loadExtension(meta, bSetup) {
        var bLoaded = false;
        var name = meta['name'];
        var version;
        var module;
        try {
            const p = path.join(this._dir, name);
            const bExist = fs.existsSync(p);
            if (!bExist || bSetup) {
                const tmpDir = this._controller.getTmpDir();
                var buffer;
                if (meta['archive']['blob'])
                    buffer = meta['archive']['blob'];
                else
                    buffer = meta['archive'];
                const folderName = await ExtensionController._unzipStream(ExtensionController._bufferToStream(buffer), tmpDir);
                const source = path.join(tmpDir, folderName);
                if (bExist)
                    fs.rmSync(p, { recursive: true, force: true });
                //fs.renameSync(source, p); // fs.rename fails if two separate partitions are involved
                fs.cpSync(source, p, { recursive: true, force: true });
                if (process.platform === 'win32')
                    await new Promise(resolve => setTimeout(resolve, 100)); //FIX
                fs.rmSync(source, { recursive: true, force: true });
            }
            const stat = fs.statSync(p);
            if (stat.isDirectory()) {
                const manifest = path.join(p, 'manifest.json');
                if (fs.existsSync(manifest)) {
                    const str = fs.readFileSync(manifest, 'utf8');
                    if (str.length > 0) {
                        const json = JSON.parse(str);
                        this._checkVersionCompatibility(json);
                        version = json['version'];
                        const extDependencies = json['ext_dependencies'];
                        if (extDependencies && Object.keys(extDependencies).length > 0) {
                            const data = await this._model.readAll();
                            var depMeta;
                            var ext;
                            var bOk;
                            for (let [key, value] of Object.entries(extDependencies)) {
                                depMeta = data.filter(function (x) { return x['name'] === key });
                                if (depMeta && depMeta.length == 1) {
                                    ext = this.getExtension(key);
                                    if (ext)
                                        bOk = ext['bLoaded'];
                                    else
                                        bOk = await this._loadExtension(depMeta[0]);
                                    if (!bOk)
                                        throw new ExtensionError('Extension \'' + name + '\' depends on \'' + key + '\' which was not loaded successfully');
                                } else
                                    throw new ExtensionError('Extension \'' + name + '\' depends on \'' + key + '\' which cannot be found');
                            }
                        }
                        const npmDependencies = json['npm_dependencies'];
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
                const state = this._controller.getState();
                if (!this._bSkipLoadingAfterRestartRequest || state == 'starting' || state == 'running') {
                    const index = path.join(p, 'index.js');
                    if (fs.existsSync(index)) {
                        const resolved = require.resolve(index);
                        if (resolved)
                            delete require.cache[resolved];
                        try {
                            module = require(index);
                            if (module) {
                                if (module.setup && bSetup) {
                                    var data = await module.setup();
                                    if (data && data['client-extension'])
                                        meta['client-extension'] = data['client-extension'];
                                }
                                if (module.init)
                                    await module.init();
                            }
                            bLoaded = true;
                        } catch (error) {
                            Logger.parseError(error);
                        }
                    }
                } else {
                    Logger.info("[ExtensionController] Not loading Extension '" + name + "' because system state is '" + state + "'");
                    bLoaded = true; //TODO: FIX otherwise extension will not be stored in database
                }
            }
        } catch (error) {
            if (error instanceof ExtensionError) {
                Logger.error("[ExtensionController] ✘ " + error.message);
            } else {
                Logger.parseError(error);
            }
        }
        var ext = {
            'name': name,
            'version': version,
            'bLoaded': bLoaded
        };
        if (meta['id'])
            ext['id'] = meta['id'];
        if (module)
            ext['module'] = module;
        this._extensions = this._extensions.filter(function (x) { return x['name'] != name });
        this._extensions.push(ext);
        if (bLoaded) {
            const info = this._controller.getInfo();
            if (!info['extensions'])
                info['extensions'] = {};
            info['extensions'][name] = {
                'version': version
            };
            Logger.info("[ExtensionController] ✔ Loaded extension '" + name + "'");
        } else
            Logger.error("[ExtensionController] ✘ Loading extension '" + name + "' failed");
        return Promise.resolve(bLoaded);
    }

    _checkVersionCompatibility(json) {
        var version = json['app_version'];
        if (version) {
            if (version.startsWith('^')) {
                var appVersion = this._controller.getVersionController().getPkgVersion();
                var reqVersion = new AppVersion(version.substring(1));
                if (appVersion.isLower(reqVersion))
                    throw new ExtensionError('Application version does not meet the extension requirements!\nApp: ' + appVersion.toString() + ', Extension: ' + version);
            }
        }
        return true;
    }

    async addExtension(req) {
        var meta;
        var id;
        if (req.method === "PUT") {
            const parts = req.path.split('/'); // req.originalUrl = '/api/data/v1/_extension/x'
            if (parts.length == 3)
                id = parseInt(parts[2]);
            else
                throw new ExtensionError('Invalid extension ID');
        }
        if (req.files && req.files['extension']) {// req.fields
            const file = req.files['extension'];
            if ((file['type'] === 'application/zip' || file['type'] === 'application/x-zip-compressed') && file['path'])
                meta = await this._addExtension(file['path'], id);
            else
                throw new ExtensionError('Extensions need to be uploaded as ZIP');
        }
        return Promise.resolve(meta);
    }

    async _addExtension(file, id) {
        var meta;
        var tmpDir = this._controller.getTmpDir();
        var extName = await ExtensionController._unzipStream(fs.createReadStream(file), tmpDir);
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

            const exist = this.getExtension(extName);
            if (exist) {
                if (id) {
                    var module = exist['module'];
                    if (module && module.teardown) {
                        try {
                            await module.teardown();
                        } catch (error) {
                            Logger.parseError(error);
                            Logger.warning("[ExtensionController] ⚠ Teardown of '" + extName + "' failed");
                        }
                    }
                } else
                    throw new ExtensionError("Skipped loading extension '" + extName + "', because no ID was provided and name already in use!");
            }

            const target = path.join(this._dir, extName);
            if (fs.existsSync(target)) {
                if (!id)
                    Logger.warning("[ExtensionController] ⚠ Extension '" + extName + "' will overwrite existing folder '" + target + "'");
                fs.rmSync(target, { recursive: true, force: true });
            }
            //fs.renameSync(source, target); // fs.rename fails if two separate partitions are involved
            fs.cpSync(source, target, { recursive: true, force: true });
            if (process.platform === 'win32')
                await new Promise(resolve => setTimeout(resolve, 100)); //FIX
            fs.rmSync(source, { recursive: true, force: true });
            meta = {};
            meta['name'] = extName;
            meta['archive'] = { 'blob': fs.readFileSync(file) };
            const bLoaded = await this._loadExtension(meta, true);
            if (bLoaded) {
                if (id) {
                    delete meta['name'];
                    meta = await this._model.update(id, meta);
                } else
                    meta = await this._model.create(meta);
            } else {
                await this._deleteExtension(extName);
                meta = null;
            }
        }
        return Promise.resolve(meta);
    }

    async deleteExtension(id) {
        var name;
        const data = await this._model.delete(id);
        if (data) {
            name = data['name'];
            await this._deleteExtension(name);
        }
        return Promise.resolve(name);
    }

    async _deleteExtension(name) {
        if (name) {
            try {
                const extension = this.getExtension(name);
                if (extension) {
                    var module = extension['module'];
                    if (module && module.teardown) {
                        try {
                            await module.teardown();
                        } catch (error) {
                            Logger.parseError(error);
                            Logger.warning("[ExtensionController] ⚠ Teardown of '" + extName + "' failed");
                        }
                    }
                }
                const p = path.join(this._dir, name);
                if (fs.existsSync(p))
                    fs.rmSync(p, { recursive: true, force: true });
            } catch (error) {
                Logger.parseError(error);
            }
            this._extensions = this._extensions.filter(function (x) { return x['name'] != name });
        }
        return Promise.resolve();
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