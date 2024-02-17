const path = require('path');
const fs = require('fs');

const Controller = require('../../src/controller/controller');

const ApiHelper = require('./api-helper.js');
const DatabaseHelper = require('./database-helper');

class TestHelper {

    static _instance;

    static async setupModels(apiHelper) {
        var modelMovies = JSON.parse(fs.readFileSync('./tests/data/models/movies.json', 'utf8'));
        await apiHelper.uploadModel(modelMovies);

        var modelStudios = JSON.parse(fs.readFileSync('./tests/data/models/studios.json', 'utf8'));
        await apiHelper.uploadModel(modelStudios);

        var modelStars = JSON.parse(fs.readFileSync('./tests/data/models/stars.json', 'utf8'));
        await apiHelper.uploadModel(modelStars);

        const shelf = controller.getShelf();
        await shelf.loadAllModels();
        await shelf.initAllModels();

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

    _depth;
    _controller;
    _webclient;
    _cdn;
    _apiUrl;
    _apiHelper;
    _databaseHelper;

    _bCleanupBeforeTests = false;
    _bCleanupAfterTests = true;

    constructor() {
        if (TestHelper._instance)
            return TestHelper._instance;
        TestHelper._instance = this;
        this._depth = 0;
    }

    async setup() {
        if (this._depth == 0) {
            if (!global.controller)
                global.controller = new Controller();
            await this.init(controller);

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
        this._apiUrl = (sc['ssl'] ? "https" : "http") + "://localhost:" + sc['port'] + "/api/data/v1";
        const webclient = this._controller.getWebClientController().getWebClient();
        this._apiHelper = new ApiHelper(this._apiUrl, webclient);

        const shelf = this._controller.getShelf();
        this._databaseHelper = new DatabaseHelper(shelf);
        return Promise.resolve();
    }

    async teardown() {
        if (this._depth == 1) {
            if (this._bCleanupAfterTests) {
                try {
                    const models = await this._apiHelper.getModel();
                    for (var model of models)
                        await this._databaseHelper.deleteModel(model);
                } catch (error) {
                    console.log(error);
                }
            }
            try {
                await this._controller.shutdown();
            } catch (error) {
                console.log(error);
            }
        }
        this._depth--;
        return Promise.resolve();
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

    getApiUrl() {
        return this._apiUrl;
    }

    getApiHelper() {
        return this._apiHelper;
    }

    getDatabaseHelper() {
        return this._databaseHelper;
    }
}

module.exports = TestHelper;