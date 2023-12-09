if (!global.controller)
    global.controller = require('../src/controller/controller');

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
    try {
        if (!controller.isRunning()) {
            const server = require('./config/server-config');
            const database = require('./config/database-config');
            await controller.setup(server, database);
            shelf = controller.getShelf();
        }

        webclient = controller.getWebClientController().getWebClient();

        const sc = controller.getServerConfig();
        apiUrl = (sc['ssl'] ? "https" : "http") + "://localhost:" + sc['port'] + "/api/data/v1";
        apiHelper = new ApiHelper(apiUrl, webclient);
        databaseHelper = new DatabaseHelper(shelf);

        if (bCleanupBeforeTests)
            ; //TODO:

        await TestHelper.setupModels(apiHelper);
        await TestHelper.setupData(apiHelper);
    } catch (error) {
        console.error(error);
        throw error;
    }
    return Promise.resolve();
});

afterAll(async () => {
    if (bCleanupAfterTests) {
        try {
            var models = await apiHelper.getModel();
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

test('#read', async function () {
    var urlRead;
    var idArr;

    urlRead = apiUrl + "/stars";
    data = await apiHelper.getData(urlRead);
    expect(data.length).toEqual(7);

    urlRead = apiUrl + "/stars/1";
    data = await apiHelper.getData(urlRead);
    expect(data['id']).toEqual(1);

    urlRead = apiUrl + "/stars/count";
    data = await apiHelper.getData(urlRead);
    expect(data).toEqual(7);

    urlRead = apiUrl + "/stars/count?movies=3";
    data = await apiHelper.getData(urlRead);
    expect(data).toEqual(2);

    urlRead = apiUrl + "/stars?_sort=name:asc";
    data = await apiHelper.getData(urlRead);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.join(',')).toEqual('5,2,4,7,3,6,1');

    urlRead = apiUrl + "/stars?_sort=name:desc";
    data = await apiHelper.getData(urlRead);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.join(',')).toEqual('1,6,3,7,4,2,5');

    urlRead = apiUrl + "/stars?_sort=name:asc&_limit=1";
    data = await apiHelper.getData(urlRead);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('5');

    urlRead = apiUrl + "/stars?_sort=name:asc&_limit=1&$field=name";
    data = await apiHelper.getData(urlRead);
    expect(JSON.stringify(data)).toEqual('[{"name":"Arnold Schwarzenegger"}]');

    urlRead = apiUrl + "/stars?_sort=name:asc&_limit=1&$field=id&$field=name";
    data = await apiHelper.getData(urlRead);
    expect(JSON.stringify(data)).toEqual('[{"id":5,"name":"Arnold Schwarzenegger"}]');

    urlRead = apiUrl + "/stars?_sort=name:asc&_limit=1&$field=id,name,movies";
    data = await apiHelper.getData(urlRead);
    expect(JSON.stringify(data)).toEqual('[{"id":5,"name":"Arnold Schwarzenegger","movies":[]}]');

    urlRead = apiUrl + "/stars/5?$field=name";
    data = await apiHelper.getData(urlRead);
    expect(data).toEqual('Arnold Schwarzenegger');

    urlRead = apiUrl + "/stars/5?$field=movies";
    data = await apiHelper.getData(urlRead);
    expect(JSON.stringify(data)).toEqual('[]');

    return Promise.resolve();
});