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

    apiUrl = "http://localhost:" + controller.getServerConfig()['port'] + "/api"
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
        await controller.teardown();
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
    var movies = JSON.parse(fs.readFileSync('./tests/data/crud/movies_2.json', 'utf8'));

    var urlMovies = apiUrl + "/movies";
    for (var movie of movies) {
        await webclient.post(urlMovies, movie);
    }

    data = await webclient.curl(urlMovies);
    expect(data.length).toEqual(movies.length);

    var stars = JSON.parse(fs.readFileSync('./tests/data/crud/stars_2.json', 'utf8'));

    var urlStars = apiUrl + "/stars";
    for (var star of stars) {
        await webclient.post(urlStars, star);
    }

    data = await webclient.curl(urlStars);
    expect(data.length).toEqual(stars.length);

    //search
    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?_limit=3";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3');

    urlSearch = apiUrl + "/stars?name_eq=Johnny Depp";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    urlSearch = apiUrl + "/stars?name_contains=Chris";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/stars?movies_null=true";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('5');

    urlSearch = apiUrl + "/stars?movies_containsAny=1,3";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_containsAll=1,3";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1');

    urlSearch = apiUrl + "/stars?movies_ncontainsAny=3";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3,4,5,6,7');

    urlSearch = apiUrl + "/stars?[or][movies]=3&[or][movies_null]=true";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,5');

    /*urlSearch = apiUrl + "/stars?[or][0][movies]=3&[or][1][movies_null]=true";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,5');*/

    urlSearch = apiUrl + "/stars?gender=female&movies_null=true";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('');

    urlSearch = apiUrl + "/stars?gender=female&movies_null=true&[or][movies]=5";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,7');

    urlSearch = apiUrl + "/stars?gender=female&[or][movies_null]=true&[or][movies]=5";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,5,6,7');

    /*urlSearch = apiUrl + "/stars?gender=female&[or][0][movies_null]=true&[or][1][movies]=5";
    data = await webclient.curl(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('7');*/

    return Promise.resolve();
});