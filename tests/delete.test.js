const fs = require('fs');

if (!global.controller)
    global.controller = require('../src/controller/controller');
const WebClient = require('../src/common/webclient.js');
const controller = require('../src/controller/controller');

const ApiHelper = require('./helper/api-helper.js');
const DatabaseHelper = require('./helper/database-helper');

var apiUrl;
var apiHelper;
var databaseHelper;
var shelf;
var webclient;
const bCleanupBeforeTests = false;
const bCleanupAfterTests = true;

beforeAll(async () => {
    if (!controller.isRunning()) {
        const server = require('./config/server-config');
        const database = require('./config/database-config');
        await controller.setup(server, database);
        shelf = controller.getShelf();
    }

    webclient = new WebClient();

    apiUrl = "http://localhost:" + controller.getServerConfig()['port'] + "/api/data/v1"
    apiHelper = new ApiHelper(apiUrl, webclient);
    databaseHelper = new DatabaseHelper(shelf);

    if (bCleanupBeforeTests)
        ; //TODO:

    return Promise.resolve();
});

afterAll(async () => {
    if (bCleanupAfterTests) {
        try {
            var models = await apiHelper.getAllModels();
            for (var model of models)
                await databaseHelper.deleteModel(model);
        } catch (error) {
            console.log(error);
        }
    }
    try {
        await controller.shutdown();
    } catch (error) {
        console.log(error);
    }
    return Promise.resolve();
});

test('movie_db', async function () {
    var modelMovies = JSON.parse(fs.readFileSync('./tests/data/models/movies.json', 'utf8'));
    await apiHelper.uploadModel(modelMovies);

    var modelStudios = JSON.parse(fs.readFileSync('./tests/data/models/studios.json', 'utf8'));
    await apiHelper.uploadModel(modelStudios);

    var modelStars = JSON.parse(fs.readFileSync('./tests/data/models/stars.json', 'utf8'));
    await apiHelper.uploadModel(modelStars);

    await shelf.loadAllModels();
    await shelf.initAllModels();

    //insert testdata
    var studios = JSON.parse(fs.readFileSync('./tests/data/crud/studios_2.json', 'utf8'));

    var urlStudios = apiUrl + "/studios";
    for (var studio of studios) {
        await webclient.post(urlStudios, studio);
    }

    data = await apiHelper.getData(urlStudios);
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

    //
    data = await apiHelper.getData(urlStudios);
    expect(data.length).toEqual(3);

    var studioId = 1;
    var urlSearch = apiUrl + "/movies?studio=" + studioId;
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3');

    var res = await webclient.delete(urlStudios + "/" + studioId);
    data = await apiHelper.getData(urlStudios);
    expect(data.length).toEqual(2);

    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3'); //TODO: result should be empty after deleting studio

    return Promise.resolve();
});