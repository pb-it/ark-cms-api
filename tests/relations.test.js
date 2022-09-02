if (!global.controller)
    global.controller = require('../src/controller/controller');
const webclient = require('../src/common/webclient.js');
const fs = require('fs');

const ApiHelper = require('./helper/api-helper.js');
const DatabaseHelper = require('./helper/database-helper');

const apiUrl = "http://localhost:3002/api";
var apiHelper;
var databaseHelper;
var knex;
var shelf;
const bCleanupBeforeTests = false;
const bCleanupAfterTests = true;


beforeAll(async () => {
    if (!controller.isRunning()) {
        const server = require('./config/server-config');
        const database = require('./config/database-config');
        await controller.setup(server, database);
        knex = controller.getKnex();
        shelf = controller.getShelf();
    }

    apiHelper = new ApiHelper(apiUrl);
    databaseHelper = new DatabaseHelper(shelf);

    if (bCleanupBeforeTests)
        ; //TODO:

    return Promise.resolve();
});

afterAll(async () => {
    if (bCleanupAfterTests) {
        var models = await apiHelper.getAllModels();
        for (var model of models)
            await databaseHelper.deleteModel(model);
    }

    return controller.teardown();
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

    var data = await apiHelper.getAllModels();

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

    //insert testdata
    var movie = JSON.parse(fs.readFileSync('./tests/data/crud/movies_1.json', 'utf8'));

    var urlMovies = apiUrl + "/movies";
    await webclient.post(urlMovies, movie);

    data = await webclient.curl(urlMovies);
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

    data = await webclient.curl(urlStudios);
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

    data = await webclient.curl(urlStars);
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

    data = await webclient.curl(urlMovies);
    expect(data.length).toEqual(1);
    res = data[0];
    expect(res['studio']['id']).toEqual(studioId);

    //update
    await webclient.put(urlMovies + "/" + movieId, { 'stars': [starId] });

    data = await webclient.curl(urlStars);
    expect(data.length).toEqual(1);
    res = data[0];
    expect(res['movies'].length).toEqual(1);
    expect(res['movies'][0]['id']).toEqual(movieId);

    return Promise.resolve();
});