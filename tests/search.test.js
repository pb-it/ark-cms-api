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

    await TestHelper.setupModels(apiHelper);
    await TestHelper.setupData(apiHelper);

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

test('#basic', async function () {
    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?id_in=1,3,5";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,3,5');

    urlSearch = apiUrl + "/stars?id_nin=1,3,5";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2,4,6,7');

    urlSearch = apiUrl + "/stars?name_eq=Johnny Depp";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    urlSearch = apiUrl + "/stars?name_contains=Chris";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/stars?_limit=3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3');

    return Promise.resolve();
});

test('#relations', async function () {
    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?movies_null=true";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('5');

    urlSearch = apiUrl + "/stars?movies=3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_any=3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_any=3&id_nin=1";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/stars?movies_any=1,3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_every=1,3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1');

    urlSearch = apiUrl + "/stars?movies_none=3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3,4,5,6,7');

    return Promise.resolve();
});

test('#relation_via', async function () {
    // aggregation via foreign single-relation
    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/studios?movies_null=false";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,3');

    urlSearch = apiUrl + "/studios?movies_null=true";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/studios?movies_count=0";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/studios?movies_count=1";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    urlSearch = apiUrl + "/studios?movies_count=2";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('');

    urlSearch = apiUrl + "/studios?movies_count=3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1');

    urlSearch = apiUrl + "/studios?movies=4";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    urlSearch = apiUrl + "/studios?movies_any=2,4";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,3');

    urlSearch = apiUrl + "/studios?movies_none=2";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2,3');

    urlSearch = apiUrl + "/studios?movies_none=2,4";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/studios?movies_every=1,2,3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1');

    urlSearch = apiUrl + "/studios?movies_every=1,2,4";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('');

    urlSearch = apiUrl + "/studios?movies_every=4";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    return Promise.resolve();
});

test('#multiple_and', async function () {
    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?gender=female&movies_null=true";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('');

    urlSearch = apiUrl + "/movies?studio_null=false&stars_null=false";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3,4');

    urlSearch = apiUrl + "/stars?[or][movies]=3&[or][movies_null]=true";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,5');

    /*urlSearch = apiUrl + "/stars?[or][0][movies]=3&[or][1][movies_null]=true";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,5');*/



    urlSearch = apiUrl + "/stars?gender=female&movies_null=true&[or][movies]=5";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,7');

    urlSearch = apiUrl + "/stars?gender=female&[or][movies_null]=true&[or][movies]=5";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,5,6,7');

    /*urlSearch = apiUrl + "/stars?gender=female&[or][0][movies_null]=true&[or][1][movies]=5";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('7');*/

    return Promise.resolve();
});

test('#multiple_or', async function () {
    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?[or][movies]=3&[or][movies_null]=true";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,5');

    /*urlSearch = apiUrl + "/stars?[or][0][movies]=3&[or][1][movies_null]=true";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,5');*/

    return Promise.resolve();
});

test('#multiple_mix', async function () {
    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?gender=female&movies_null=true&[or][movies]=5";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,7'); // female && null || 5 -> zero female without movies; two actors with movie 5

    urlSearch = apiUrl + "/stars?gender=female&[or][movies_null]=true&[or][movies]=5";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,5,6,7'); // female || null || 5

    /*urlSearch = apiUrl + "/stars?gender=female&[or][0][movies_null]=true&[or][1][movies]=5";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('7');*/

    return Promise.resolve();
});