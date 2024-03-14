const path = require('path');
const fs = require('fs');

const common = require('../common/common');
const Logger = require('../common/logger/logger');

class DependencyController {

    _controller;
    _appRoot;

    _packageJson;
    _installedJson;

    _bUseNpmList = false;
    _foundNpm;

    _bUseAddDep = true;
    _locationAddDep;
    _foundDir;

    constructor(controller) {
        this._controller = controller;
        this._appRoot = controller.getAppRoot();
        this._packageJson = path.join(this._appRoot, 'package.json');
    }

    async init() {
        this._installedJson = this._readPackageJson();
        this._foundNpm = await this._readNpm();
        if (this._bUseAddDep)
            await this._initAddDep();
        else
            this._locationAddDep = null;
        if (this._locationAddDep)
            this._foundDir = this._readModulesDirectory();
        else
            this._foundDir = null;
        return Promise.resolve();
    }

    async _initAddDep() {
        if (!this._locationAddDep) {
            if (Object.keys(this._installedJson).includes('add-dependencies'))
                this._locationAddDep = 'local';
            else {
                try {
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
                } catch (error) {
                    Logger.parseError(error);
                }
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
        return Promise.resolve();
    }

    async _readNpm() {
        var found;
        var response
        try {
            response = await common.exec('npm list -json');
        } catch (error) {
            try {
                await common.exec('cd ' + this._appRoot + ' && npm install --legacy-peer-deps');
                response = await common.exec('npm list -json');
            } catch (error) {
                if (error['message'] && error['message'].startsWith('Command failed: npm list -json')) {
                    Logger.error("[DependencyController] ✘ npm ERR!");
                    console.error(error);
                } else
                    Logger.parseError(error);
            }
        }
        if (response) {
            const obj = JSON.parse(response);
            if (obj && obj['dependencies'])
                found = obj['dependencies'];
        }
        return Promise.resolve(found);
    }

    _readPackageJson() {
        const data = fs.readFileSync(this._packageJson, 'utf8');
        const pkg = JSON.parse(data);
        return pkg['dependencies'];
    }

    _readModulesDirectory() {
        const found = [];
        const modulesDir = path.join(this._appRoot, 'node_modules');
        var packageJsonFile;
        var data;
        for (var dir of fs.readdirSync(modulesDir)) {
            if (dir.indexOf('.') !== 0) {
                packageJsonFile = path.join(modulesDir, dir, 'package.json');
                if (fs.existsSync(packageJsonFile)) {
                    data = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8'));
                    found[data['name']] = data['version'];
                }
            }
        }
        return found;
    }

    async installDependencies(arr) {
        const debug = this._controller.getServerConfig()['debug'];
        if (!debug || !debug['skipInstall']) {
            const installedJsonNames = Object.keys(this._installedJson);
            var foundDirNames;
            if (this._bUseAddDep && this._foundDir)
                foundDirNames = Object.keys(this._foundDir);
            const addFoundDir = [];
            const missing = [];
            var split;
            var name;
            var version;
            for (var ident of arr) {
                name = null;
                version = null;
                split = ident.split('@');
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
                } else if (this._bUseNpmList && this._foundNpm && this._foundNpm.hasOwnProperty(name)) {
                    if (!version || version == this._foundNpm[name]['version'] || (version.startsWith('github:') && this._foundNpm[name]['version'] == '0.0.0-development'))
                        continue;
                } else if (this._foundDir && foundDirNames && foundDirNames.includes(name)) {
                    //TODO: check if directory still exists because an npm operation may have purged node_modules
                    if (!version || version == this._foundDir[name] || (version.startsWith('github:') && this._foundDir[name] == '0.0.0-development')) {
                        if (!version) {
                            version = this._foundDir[name];
                            ident = `${name}@^${version}`;
                        }
                        addFoundDir.push(ident);
                        continue;
                    }
                }
                missing.push(ident);
            }

            if (addFoundDir.length > 0) {
                var bError;
                try {
                    await this._addDependencies(addFoundDir);
                } catch (error) {
                    Logger.parseError(error);
                    bError = true;
                }
                if (bError)
                    missing.push(...addFoundDir);
                else {
                    try {
                        var ident;
                        for (var name of names) {
                            ident = require(name);
                        }
                    } catch (error) {
                        controller.setRestartRequest();
                    }
                }
            }
            if (missing.length > 0)
                await this._install(missing);
            try {
                var tmp;
                for (var ident of arr) {
                    tmp = require(name);
                }
            } catch (error) {
                if (error['code'] == 'MODULE_NOT_FOUND')
                    controller.setRestartRequest();
                else
                    throw error;
            }
        }
        return Promise.resolve();
    }

    /**
     * add-dependencies only adds the dependency to package.json without installing it
     * still has to fork npm processes for version checks which are quite time-consuming
     */
    async _addDependencies(arr) {
        Logger.info('[App] Adding dependencies \'' + arr.join('\', \'') + '\'');
        if (this._locationAddDep == 'global')
            await common.exec('add-dependencies ' + this._packageJson + ' ' + arr.join(' ') + ' --no-overwrite');
        else if (this._locationAddDep == 'local')
            await common.exec('./node_modules/add-dependencies/index.js ' + this._packageJson + ' ' + arr.join(' ') + ' --no-overwrite');
        return Promise.resolve();
    }

    async _install(names) {
        if (names) {
            Logger.info('[App] Installing missing dependencies \'' + names.join('\', \'') + '\'');
            await common.exec('cd ' + this._appRoot + ' && npm install ' + names.join(' ') + ' --legacy-peer-deps');
        } else {
            Logger.info('[App] Installing new dependencies');
            await common.exec('cd ' + this._appRoot + ' && npm install --legacy-peer-deps');
        }
        return Promise.resolve();
    }
}

module.exports = DependencyController;