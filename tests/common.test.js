const fs = require('fs');

if (!global.controller)
    global.controller = require('../src/controller/controller');
const webclient = require('../src/common/webclient.js');

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

test('media', async function () {
    var model = JSON.parse(fs.readFileSync('./tests/data/models/media.json', 'utf8'));

    await apiHelper.uploadModel(model);

    var data = await apiHelper.getAllModels();
    var res = data.filter(function (x) {
        return x['definition']['name'] === "media";
    })[0];
    var modelId = res['id'];
    expect(res['definition']).toEqual(model);

    var media = JSON.parse(fs.readFileSync('./tests/data/crud/media_1.json', 'utf8'));

    var url = apiUrl + "/media";
    await webclient.post(url, media);

    data = await webclient.curl(url);
    expect(data.length).toEqual(1);

    res = data[0];
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];
    delete res['file'];

    expect(res).toEqual(media);

    return Promise.resolve();
});

/**
 * mostly tests for testing visual representation of data after test run
 */
test('snippets', async function () {
    var model = JSON.parse(fs.readFileSync('./tests/data/models/snippets.json', 'utf8'));

    var def = await apiHelper.uploadModel(model);

    var data = await apiHelper.getAllModels();
    var res = data.filter(function (x) {
        return x['definition']['name'] === "snippets";
    })[0];
    var modelId = res['id'];
    expect(res['definition']).toEqual(model);

    // 1
    var snippet = JSON.parse(fs.readFileSync('./tests/data/crud/snippets_1.json', 'utf8'));

    var url = apiUrl + "/snippets";
    await webclient.post(url, snippet);

    data = await webclient.curl(url);
    expect(data.length).toEqual(1);

    res = data[0];
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];

    expect(res).toEqual(snippet);

    // 2
    snippet = JSON.parse(fs.readFileSync('./tests/data/crud/snippets_2.json', 'utf8'));
    await webclient.post(url, snippet);

    // 3
    snippet = JSON.parse(fs.readFileSync('./tests/data/crud/snippets_3.json', 'utf8'));
    //expect(async () => { return webclient.post(url, snippet); }).toThrow(Error);
    var err;
    try {
        res = await webclient.post(url, snippet);
    } catch (error) {
        err = error;
    }
    expect(err['message']).toEqual('Request failed with status code 500');

    await databaseHelper.deleteModel(def);

    model['charEncoding'] = 'utf8mb4';
    await apiHelper.uploadModel(model);

    res = await webclient.post(url, snippet);
    var id = res['data']['id'];

    res = await webclient.curl(url + "/" + id);
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];

    expect(res).toEqual(snippet);

    return Promise.resolve();
});