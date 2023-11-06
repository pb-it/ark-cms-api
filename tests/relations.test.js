const fs = require('fs');

if (!global.controller)
    global.controller = require('../src/controller/controller');
const WebClient = require('../src/common/webclient.js');
const controller = require('../src/controller/controller');

const ApiHelper = require('./helper/api-helper.js');
const DatabaseHelper = require('./helper/database-helper');
const TestHelper = require('./helper/test-helper');

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
    await TestHelper.setupModels(apiHelper);

    //insert testdata
    var movie = JSON.parse(fs.readFileSync('./tests/data/crud/movies_1.json', 'utf8'));

    var urlMovies = apiUrl + "/movies";
    await webclient.post(urlMovies, movie);

    data = await apiHelper.getData(urlMovies);
    expect(data.length).toEqual(1);

    var resMovie = data[0];
    var resMovieAll = { ...resMovie };
    var movieId = resMovie['id'];
    delete resMovie['id'];
    delete resMovie['created_at'];
    delete resMovie['updated_at'];
    delete resMovie['studio'];
    delete resMovie['stars'];

    expect(resMovie).toEqual(movie);

    var studio = JSON.parse(fs.readFileSync('./tests/data/crud/studios_1.json', 'utf8'));

    var urlStudios = apiUrl + "/studios";
    await webclient.post(urlStudios, studio);

    data = await apiHelper.getData(urlStudios);
    expect(data.length).toEqual(1);

    var resStudio = data[0];
    var studioId = resStudio['id'];
    delete resStudio['id'];
    delete resStudio['created_at'];
    delete resStudio['updated_at'];
    delete resStudio['movies'];

    expect(resStudio).toEqual(studio);

    var star = JSON.parse(fs.readFileSync('./tests/data/crud/stars_1.json', 'utf8'));

    var urlStars = apiUrl + "/stars";
    await webclient.post(urlStars, star);

    data = await apiHelper.getData(urlStars);
    expect(data.length).toEqual(1);

    var resStar = data[0];
    var starId = resStar['id'];
    delete resStar['id'];
    delete resStar['created_at'];
    delete resStar['updated_at'];
    delete resStar['movies'];

    expect(resStar).toEqual(star);

    //update via relation
    res = await webclient.put(urlStudios + "/" + studioId, { 'movies': [movieId] });
    expect(res['data']['movies'].length).toEqual(1);
    expect(res['data']['movies'][0]['id']).toEqual(movieId);

    data = await apiHelper.getData(urlMovies);
    expect(data.length).toEqual(1);
    res = data[0];
    expect(res['studio']['id']).toEqual(studioId);

    //update
    await webclient.put(urlMovies + "/" + movieId, { 'stars': [starId] });

    data = await apiHelper.getData(urlStars);
    expect(data.length).toEqual(1);
    res = data[0];
    expect(res['movies'].length).toEqual(1);
    expect(res['movies'][0]['id']).toEqual(movieId);

    return Promise.resolve();
});