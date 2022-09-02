const path = require('path');
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

const cdn = path.join(controller.getAppRoot(), '../cdn/');

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

test('youtube', async function () {
    //jest.setTimeout(30000);

    var model = JSON.parse(fs.readFileSync('./tests/data/models/youtube.json', 'utf8'));

    await apiHelper.uploadModel(model);

    var video = JSON.parse(fs.readFileSync('./tests/data/crud/youtube_1.json', 'utf8'));

    var url = apiUrl + "/youtube";
    var res = await webclient.post(url, video);
    var file = 'dQw4w9WgXcQ.mp4';
    expect(res['data']['video']).toEqual(file);
    expect(fs.existsSync(cdn + file)).toEqual(true);

    var idUrl = url + '/' + res['data']['id'];
    await webclient.delete(idUrl);
    data = await webclient.curl(url);
    expect(data.length).toEqual(0);
    expect(fs.existsSync(cdn + file)).toEqual(false);

    return Promise.resolve();
}, 30000);