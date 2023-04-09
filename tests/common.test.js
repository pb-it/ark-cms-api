const path = require('path');
const fs = require('fs');

if (!global.controller)
    global.controller = require('../src/controller/controller');
const WebClient = require('../src/common/webclient.js');
const base64 = require('../src/common/base64');

const ApiHelper = require('./helper/api-helper.js');
const DatabaseHelper = require('./helper/database-helper');

var cdn;
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

    const cdnConfig = require('./config/cdn-config');
    var cdns = cdnConfig.filter(function (x) {
        return x['url'] === '/cdn'; //TODO: get correct cdn from attribute
    });
    if (cdns.length == 1)
        cdn = path.join(controller.getAppRoot(), cdns[0]['path']);

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

/**
 * url & base64
 */
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
    var base64 = await webclient.fetchBase64(media['url']);
    //media['base64'] = { 'base64': base64 };
    media['base64'] = { 'url': media['url'] };
    /*await fetch(url)
        .then((response) => response.buffer())
        .then((buffer) => {
            const b64 = buffer.toString('base64');
            return b64;
        })
        .catch(console.error);*/

    var url = apiUrl + "/media";
    await webclient.post(url, media);

    data = await apiHelper.getData(url);
    expect(data.length).toEqual(1);

    expect(data[0]['base64']).toEqual(base64);

    return Promise.resolve();
});

test('files', async function () {
    var model = JSON.parse(fs.readFileSync('./tests/data/models/files.json', 'utf8'));

    await apiHelper.uploadModel(model);

    var data = await apiHelper.getAllModels();
    var res = data.filter(function (x) {
        return x['definition']['name'] === "files";
    })[0];
    var modelId = res['id'];
    expect(res['definition']).toEqual(model);

    var fData = JSON.parse(fs.readFileSync('./tests/data/crud/files_1.json', 'utf8'));

    var url = apiUrl + "/files";
    await webclient.post(url, fData);

    data = await apiHelper.getData(url);
    expect(data.length).toEqual(1);

    var file = data[0]['file'];
    //expect(res).toEqual(media);
    var fPath = cdn + "/" + file;
    expect(fs.existsSync(fPath)).toEqual(true);

    fs.unlinkSync(fPath);

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

    data = await apiHelper.getData(url);
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
    //jest.spyOn(console, 'error').mockImplementation(() => { });
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

    res = await apiHelper.getData(url + "/" + id);
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];

    expect(res).toEqual(snippet);

    return Promise.resolve();
});