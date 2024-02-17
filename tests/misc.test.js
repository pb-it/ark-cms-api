const sleep = require('util').promisify(setTimeout);

const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

test('#custom_route', async function () {
    const controller = testHelper.getController();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

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