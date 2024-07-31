const path = require('path');
const fs = require('fs');
//const fetch = require('cross-fetch');

const Controller = require('../../src/controller/controller');
const FetchWebClient = require('../../src/common/webclient/fetch-webclient');

const ApiHelper = require('./api-helper.js');

class TestHelper {

    static _instance;

    static async setupScenario(scenario) {
        const apiHelper = testHelper.getApiHelper();
        switch (scenario) {
            case 1:
                const models = await apiHelper.getModel();
                for (var model of models) {
                    if (!model['definition']['name'].startsWith('_'))
                        await apiHelper.deleteModel(model['id']);
                }
                await TestHelper.setupModels(apiHelper);
                await TestHelper.setupData(apiHelper);
                break;
        }
        return Promise.resolve();
    }

    static async setupModels(apiHelper) {
        var modelMovies = JSON.parse(fs.readFileSync('./tests/data/models/movies.json', 'utf8'));
        await apiHelper.uploadModel(modelMovies);

        var modelStudios = JSON.parse(fs.readFileSync('./tests/data/models/studios.json', 'utf8'));
        await apiHelper.uploadModel(modelStudios);

        var modelStars = JSON.parse(fs.readFileSync('./tests/data/models/stars.json', 'utf8'));
        await apiHelper.uploadModel(modelStars);

        var data = await apiHelper.getModel();

        var res = data.filter(function (x) {
            return x['definition']['name'] === "movies";
        })[0];
        var modelMoviesId = res['id'];
        expect(res['definition']).toEqual(modelMovies);

        res = data.filter(function (x) {
            return x['definition']['name'] === "studios";
        })[0];
        var modelStudiosId = res['id'];
        expect(res['definition']).toEqual(modelStudios);

        res = data.filter(function (x) {
            return x['definition']['name'] === "stars";
        })[0];
        var modelStarsId = res['id'];
        expect(res['definition']).toEqual(modelStars);
    }

    static async setupData(apiHelper) {
        const apiUrl = apiHelper.getUrl();
        const webclient = apiHelper.getWebClient();
        var studios = JSON.parse(fs.readFileSync('./tests/data/crud/studios_2.json', 'utf8'));

        var urlStudios = apiUrl + "/studios";
        for (var studio of studios) {
            await webclient.post(urlStudios, studio);
        }

        var data = await apiHelper.getData(urlStudios);
        expect(data.length).toEqual(studios.length);

        var movies = JSON.parse(fs.readFileSync('./tests/data/crud/movies_2.json', 'utf8'));

        var urlMovies = apiUrl + "/movies";
        for (var movie of movies) {
            await webclient.post(urlMovies, movie);
        }

        data = data = await apiHelper.getData(urlMovies);
        expect(data.length).toEqual(movies.length);

        var stars = JSON.parse(fs.readFileSync('./tests/data/crud/stars_2.json', 'utf8'));

        var urlStars = apiUrl + "/stars";
        for (var star of stars) {
            await webclient.post(urlStars, star);
        }

        data = data = await apiHelper.getData(urlStars);
        expect(data.length).toEqual(stars.length);

        return Promise.resolve();
    }

    static async restart() {
        if (process.env.REMOTE === 'true') {
            var res;
            try {
                const host = testHelper.getHost();
                const url = host + '/sys/restart';
                const webclient = testHelper.getWebclient();
                res = await webclient.get(url);
            } catch (error) {
                console.log(error);
            }
            if (res !== 'OK')
                throw new Error('Restarting API failed');
        } else {
            const controller = testHelper.getController();
            if (controller) {
                const serverConfig = controller.getServerConfig();
                const databaseConfig = controller.getDatabaseConfig();
                await controller.shutdown();
                await controller.setup(serverConfig, databaseConfig);
                await testHelper.init(controller);
            }
        }
        return Promise.resolve();
    }

    static async clearDatabase(schema) {
        var res;
        try {
            const data = {
                'cmd': `const path = require('path');
const appRoot = controller.getAppRoot();
const Logger = require(path.join(appRoot, './src/common/logger/logger.js'));

async function test() {
   var res;
   var schema = ${schema};
   if (!schema)
      schema = controller.getDatabaseSettings()['connection']['database'];
   Logger.info("Clearing database '" + schema + "'");
   const knex = controller.getKnex();
   var rs = await knex.raw("DROP DATABASE " + schema + ";");
   rs = await knex.raw("CREATE DATABASE " + schema + ";");
   return Promise.resolve('OK');
};
module.exports = test;`};

            const host = testHelper.getHost();
            const url = host + '/sys/tools/dev/eval?_format=text';
            const webclient = testHelper.getWebclient();
            res = await webclient.post(url, data);
        } catch (error) {
            console.log(error);
        }
        if (res !== 'OK')
            throw new Error('Clearing database failed');
        return Promise.resolve();
    }

    static async backup(file) {
        const host = testHelper.getHost();
        const webclient = testHelper.getWebclient(); //testHelper.getApiHelper().getWebClient();
        return webclient.download(host + '/sys/tools/db/backup', file);
    }

    static async restore(file) {
        if (path.extname(file) === '.sql') {
            const host = testHelper.getHost();
            //const webclient = testHelper.getWebclient();
            const formData = new FormData();
            //formData.append('file', fs.createReadStream(file));
            const blob = new Blob([fs.readFileSync(file)], { type: 'application/sql' });
            formData.append('file', blob, path.basename(file));
            /*formData.append('file', blob, {
                contentType: 'application/sql',
                name: 'file',
                filename: path.basename(file),
            });*/
            //await webclient.post(host + '/sys/tools/db/restore', formData);
            const response = await fetch(host + '/sys/tools/db/restore', { method: 'POST', body: formData });
            if (response['status'] !== 200) {
                console.error(await response.text());
                throw new Error('Restoring database dump failed');
            }
        } else
            throw new Error('File extension needs to be \'.sql\'');
        return Promise.resolve();
    }

    _config;
    _bRemote;
    _depth;
    _controller;
    _webclient;
    _cdn;
    _apiUrl;
    _apiHelper;

    _bCleanupBeforeTests = false;
    _bCleanupAfterTests = true;

    constructor() {
        if (TestHelper._instance)
            return TestHelper._instance;
        TestHelper._instance = this;
        this._config = require('../config/test-config');
        this._bRemote = process.env.REMOTE === 'true';
        this._depth = 0;
    }

    async setup() {
        if (this._depth == 0) {
            if (this._bRemote) {
                const remoteConfig = this._config['remote'];
                if (remoteConfig) {
                    this._webclient = new FetchWebClient();
                    this._cdn = remoteConfig['cdn'];
                    this._host = remoteConfig['host'];
                    this._apiUrl = this._host + '/api/data/v1';
                    this._apiHelper = new ApiHelper(this._apiUrl, remoteConfig['appVersion'], this._webclient);
                } else
                    throw new Error('Missing configuration for remote target');
            } else {
                if (!global.controller)
                    global.controller = new Controller();
                await this.init(controller);
            }

            if (this._bCleanupBeforeTests)
                ; //TODO:
        }
        this._depth++;
        return Promise.resolve();
    }

    async init(controller) {
        this._controller = controller;
        if (!this._controller.isRunning()) {
            const server = require('../config/server-config');
            const database = require('../config/database-config');
            await this._controller.setup(server, database);
        }
        this._webclient = this._controller.getWebClientController().getWebClient();

        const cdnConfig = this._controller.getFileStorage();
        if (cdnConfig) {
            var cdns = cdnConfig.filter(function (x) {
                return x['url'] === '/cdn'; //TODO: get correct cdn from attribute
            });
            if (cdns.length == 1)
                this._cdn = path.join(this._controller.getAppRoot(), cdns[0]['path']);
        }

        const sc = this._controller.getServerConfig();
        this._host = (sc['ssl'] ? "https" : "http") + "://localhost:" + sc['port'];
        this._apiUrl = this._host + "/api/data/v1";
        this._apiHelper = new ApiHelper(this._apiUrl, this._controller.getVersionController().getPkgVersion(), this._webclient);

        return Promise.resolve();
    }

    async teardown() {
        if (this._depth == 1) {
            if (this._bCleanupAfterTests) {
                try {
                    const models = await this._apiHelper.getModel();
                    for (var model of models) {
                        if (!model['definition']['name'].startsWith('_'))
                            await this._apiHelper.deleteModel(model['id']);
                    }
                } catch (error) {
                    console.log(error);
                }
            }

            if (!this._bRemote) {
                try {
                    await this._controller.shutdown();
                } catch (error) {
                    console.log(error);
                }
            }
        }
        this._depth--;
        return Promise.resolve();
    }

    getTestConfig() {
        return this._config;
    }

    getController() {
        return this._controller;
    }

    getWebclient() {
        return this._webclient;
    }

    getCdn() {
        return this._cdn;
    }

    getHost() {
        return this._host;
    }

    getApiUrl() {
        return this._apiUrl;
    }

    getApiHelper() {
        return this._apiHelper;
    }
}

module.exports = TestHelper;