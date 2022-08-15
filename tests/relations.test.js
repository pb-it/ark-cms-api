const controller = require('../src/controller/controller');
const webclient = require('../src/common/webclient.js');
const fs = require('fs');

const modelsUrl = "http://localhost:3002/models?v=0.1.1-beta";
const apiUrl = "http://localhost:3002/api";
var knex;
var shelf;
const bCleanupBeforeTests = false;
const bCleanupAfterTest = false;

beforeAll(async () => {
    const server = require('./config/server');
    const database = require('./config/database');
    await controller.setup(server, database);
    knex = controller.getKnex();
    shelf = controller.getShelf();

    if (bCleanupBeforeTests)
        ; //TODO:

    return Promise.resolve();
});

afterAll(() => {
    controller.teardown();
});

test('movie_db', async function () {
    var modelMovies = JSON.parse(fs.readFileSync('./tests/data/models/movies.json', 'utf8'));
    await uploadModel(modelMovies);

    var modelStudios = JSON.parse(fs.readFileSync('./tests/data/models/studios.json', 'utf8'));
    await uploadModel(modelStudios);

    var modelStars = JSON.parse(fs.readFileSync('./tests/data/models/stars.json', 'utf8'));
    await uploadModel(modelStars);

    await shelf.loadAllModels();
    await shelf.initAllModels();

    var data = await webclient.curl(modelsUrl);

    var res = data.filter(function (x) {
        return x['name'] === "movies";
    })[0];
    var modelMoviesId = res['id'];
    delete res['id'];
    expect(res).toEqual(modelMovies);

    res = data.filter(function (x) {
        return x['name'] === "studios";
    })[0];
    var modelStudiosId = res['id'];
    delete res['id'];
    expect(res).toEqual(modelStudios);

    res = data.filter(function (x) {
        return x['name'] === "stars";
    })[0];
    var modelStarsId = res['id'];
    delete res['id'];
    expect(res).toEqual(modelStars);

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

    if (bCleanupAfterTest) {
        await shelf.deleteModel(modelStarsId);
        data = await webclient.curl(modelsUrl);
        res = data.filter(function (x) {
            return x['name'] === "stars";
        });
        expect(res.length).toEqual(0);

        try {
            await knex.schema.dropTable('stars');
        } catch (err) {
            console.log(err.message);
        }
    }
    return Promise.resolve();
});

async function uploadModel(model) {
    try {
        await webclient.put(modelsUrl, model);
    } catch (error) {
        console.log(error);
        var msg;
        if (error['message']) {
            msg = error['message'];
            if (error['response']['data'])
                msg += ": " + error['response']['data'];
        }

        if (msg)
            throw new Error(msg);
        else
            throw error;
    }
    return Promise.resolve();
}