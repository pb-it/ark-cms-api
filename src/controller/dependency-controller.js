const path = require('path');
const fs = require('fs');

const common = require('../common/common');
const Logger = require('../common/logger/logger');

class DependencyController {

    _controller;
    _appRoot;
    _file;
    _packageJson;
    _installedJson;
    _foundDir;
    _locationAddDep;
    _bAddFoundDir = false;

    constructor(controller) {
        this._controller = controller;
        this._appRoot = controller.getAppRoot();
        this._file = path.join(this._appRoot, 'package.json');
        this._installedJson = this._readPackageJson();
        this._foundDir = this._readModulesDirectory();
    }

    _readPackageJson() {
        var data = fs.readFileSync(this._file, 'utf8');
        var pkg = JSON.parse(data);
        return pkg['dependencies'];
    }

    _readModulesDirectory() {
        var modDir = path.join(this._appRoot, 'node_modules');
        var dirs = fs.readdirSync(modDir);
        var packageJsonFile;
        var found = [];
        var data;
        for (var dir of dirs) {
            if (dir.indexOf(".") !== 0) {
                packageJsonFile = path.join(modDir, dir, "package.json");
                if (fs.existsSync(packageJsonFile)) {
                    data = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8'));
                    found[data['name']] = data['version'];
                }
            }
        }
        return found;
    }

    async installDependencies(arr) {
        var debug = this._controller.getServerConfig()['debug'];
        if (!debug || !debug['skipInstall']) {
            var installedJsonNames = Object.keys(this._installedJson);
            var foundDirNames = Object.keys(this._foundDir);
            var addFoundDir = [];
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

                if (installedJsonNames.includes(name)) {
                    if (!version || version == this._installedJson[name])
                        continue;
                } else if (foundDirNames.includes(name)) {
                    if (!version || version == this._foundDir[name] || version.startsWith('github:') && this._foundDir[name] == '0.0.0-development') {
                        if (!version) {
                            version = this._foundDir[name];
                            x = `${name}@^${version}`;
                        }
                        addFoundDir.push({ 'ident': x, 'name': name, 'version': version });
                        continue;
                    }
                }
                missing.push({ 'ident': x, 'name': name, 'version': version })
            }

            if (this._bAddFoundDir && addFoundDir.length > 0) {
                var names = addFoundDir.map(function (x) { return x['ident'] });
                await this._addDependencies(names);
            }

            if (missing.length > 0) {
                var names = missing.map(function (x) { return x['ident'] });
                await this._install(names);
            }
        }
        return Promise.resolve();
    }

    /**
     * add-dependencies only adds the dependency to package.json without installing it
     * still has to fork npm processes for version checks which are quite time-consuming
     */
    async _addDependencies(arr) {
        if (!this._locationAddDep) {
            //var res = await exec('npm list --location=global add-dependencies');
            var json = await common.exec('npm list --location=global -json'); // --silent --legacy-peer-deps
            var obj = JSON.parse(json);
            if (obj && obj['dependencies'] && obj['dependencies']['add-dependencies'])
                this._locationAddDep = 'global';
            else {
                json = await common.exec('npm list -json');
                obj = JSON.parse(json);
                if (obj && obj['dependencies'] && obj['dependencies']['add-dependencies'])
                    this._locationAddDep = 'local';
            }
        }
        if (!this._locationAddDep) {
            Logger.info('[App] Installing \'add-dependencies\' ...');
            try {
                await common.exec('npm install add-dependencies --location=global');
                this._locationAddDep = 'global';
            } catch (error) {
                await common.exec('npm install add-dependencies --legacy-peer-deps');
                this._locationAddDep = 'local';
            }
        }

        Logger.info('[App] Adding dependencies \'' + arr.join('\', \'') + '\'');
        if (this._locationAddDep == 'global')
            await common.exec('add-dependencies ' + this._file + ' ' + arr.join(' ') + ' --no-overwrite');
        else if (this._locationAddDep == 'local')
            await common.exec('./node_modules/add-dependencies/index.js ' + this._file + ' ' + arr.join(' ') + ' --no-overwrite');
        return Promise.resolve();
    }

    async _install(names) {
        if (names) {
            var dir;
            for (var name of names) {
                dir = path.join(this._appRoot, name);
                if (fs.existsSync(dir))
                    fs.rmSync(dir, { recursive: true, force: true });
            }

            Logger.info('[App] Installing missing dependencies \'' + names.join('\', \'') + '\'');
            await common.exec('cd ' + this._appRoot + ' && npm install ' + names.join(' ') + ' --legacy-peer-deps');

            try {
                var x;
                for (var name of names) {
                    x = require(name);
                }
            } catch (error) {
                controller.setRestartRequest();
            }
        } else {
            Logger.info('[App] Installing new dependencies');
            await common.exec('cd ' + this._appRoot + ' && npm install --legacy-peer-deps');
            controller.setRestartRequest();
        }
        return Promise.resolve();
    }
}

module.exports = DependencyController;