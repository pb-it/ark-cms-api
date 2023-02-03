const path = require('path');
const fs = require('fs');

if (!global.controller)
    global.controller = require('../src/controller/controller');
const webclient = require('../src/common/webclient.js');

const ApiHelper = require('./helper/api-helper.js');
const DatabaseHelper = require('./helper/database-helper');

var cdn;
var rootUrl;
var apiUrl;
var apiHelper;
var databaseHelper;
var shelf;
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

        const cdnConfig = require('./config/cdn-config');
        var cdns = cdnConfig.filter(function (x) {
            return x['url'] === '/cdn'; //TODO: get correct cdn from attribute
        });
        if (cdns.length == 1)
            cdn = path.join(controller.getAppRoot(), cdns[0]['path']);

        rootUrl = "http://localhost:" + controller.getServerConfig()['port'];
        apiUrl = rootUrl + "/api";
        apiHelper = new ApiHelper(apiUrl);
        databaseHelper = new DatabaseHelper(shelf);

        if (bCleanupBeforeTests)
            ; //TODO:

    } catch (error) {
        console.log(error);
    }

    return Promise.resolve();
}, 30000);

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

test('youtube', async function () {
    //jest.setTimeout(30000);

    var model = JSON.parse(fs.readFileSync('./tests/data/models/youtube.json', 'utf8'));

    await apiHelper.uploadModel(model);

    var urlInfo = rootUrl + "/system/info";
    var data = await webclient.curl(urlInfo);
    if (data['state'] === 'openRestartRequest') {
        var urlRestart = rootUrl + "/system/restart";
        data = await webclient.curl(urlRestart); //TODO: find server restart procedure without terminating test
        await new Promise(r => setTimeout(r, 5000));
    }

    var video = JSON.parse(fs.readFileSync('./tests/data/crud/youtube_1.json', 'utf8'));

    var url = apiUrl + "/youtube";
    var res = await webclient.post(url, video);
    var file = 'dQw4w9WgXcQ.mp4';
    expect(res['data']['video']).toEqual(file);
    var fPath = cdn + "/" + file;
    expect(fs.existsSync(fPath)).toEqual(true);

    var idUrl = url + '/' + res['data']['id'];
    await webclient.delete(idUrl);
    data = await webclient.curl(url);
    expect(data.length).toEqual(0);
    expect(fs.existsSync(fPath)).toEqual(false);

    return Promise.resolve();
}, 60000);