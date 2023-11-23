const sleep = require('util').promisify(setTimeout);

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

        //await TestHelper.setupModels(apiHelper);
        //await TestHelper.setupData(apiHelper);
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

test('#custom_route', async function () {
    const route = {
        'regex': '^/test/(\\d+)$',
        'fn': async function (req, res) {
            const data = {
                'message': `Custom response for 'test' with id:${req.locals['match'][1]}!`
            };
            await sleep(2000);
            if (!res.headersSent)
                res.json({ 'data': data }); // response with your own data
            return Promise.resolve();
        }
    };
    controller.getWebServer().addCustomDataRoute(route);

    const url = apiUrl + "/test/1";
    var data = await apiHelper.getData(url);
    expect(data['message']).toEqual("Custom response for 'test' with id:1!");

    const sc = controller.getServerConfig();
    sc['api'] = {
        'timeout': 1000
    };

    var err;
    try {
        data = await apiHelper.getData(url);
    } catch (error) {
        err = error;
    }
    expect(err['message']).toEqual('504: Gateway Timeout - ' + url);

    controller.getWebServer().deleteCustomDataRoute(route);
    try {
        data = await apiHelper.getData(url);
    } catch (error) {
        err = error;
    }
    expect(err['message']).toEqual('404: Not Found - ' + url);

    delete sc['api'];

    return Promise.resolve();
});