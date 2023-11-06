if (!global.controller)
    global.controller = require('../src/controller/controller.js');
const WebClient = require('../src/common/webclient.js');
const controller = require('../src/controller/controller.js');

const ApiHelper = require('./helper/api-helper.js');
const DatabaseHelper = require('./helper/database-helper.js');
const TestHelper = require('./helper/test-helper.js');

var apiUrl;
var apiHelper;
var databaseHelper;
var shelf;
var webclient;
const bCleanupBeforeTests = false;
const bCleanupAfterTests = true;

beforeAll(async () => {
    if (!controller.isRunning()) {
        const server = require('./config/server-config.js');
        const database = require('./config/database-config.js');
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

test('#eval', async function () {
    var snippet = `async function eval() {
    const model = controller.getShelf().getModel('studios');
    var tmp = await model.readAll({ 'movies_any': 4 });
    return Promise.resolve(tmp);
};
module.exports = eval;`;
    var url = "http://localhost:" + controller.getServerConfig()['port'] + "/sys/tools/dev/eval?_format=text";
    var response = await webclient.post(url, { 'cmd': snippet });
    /*try {
        var res = await webclient.post(url, { 'cmd': snippet });
    } catch (error) {
        console.log(error);
    }*/
    var res = response.data.map((x) => x['id']).join(',')
    expect(res).toEqual('3');
    return Promise.resolve();
});