const itif = (condition) => condition ? it : it.skip;

const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

it('#custom_route', async function () {
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var func = function () {
        const route = {
            'regex': '^/test/(\\d+)$',
            'fn': async function (req, res) {
                const sleep = require('util').promisify(setTimeout);
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
    }

    var snippet = `async function eval() {
        ${func.toString().match(/function[^{]+\{([\s\S]*)\}$/)[1].trim()}
        return Promise.resolve('OK');
    };
    module.exports = eval;`;
    var url = testHelper.getHost() + "/sys/tools/dev/eval?_format=text";
    const response = await webclient.post(url, { 'cmd': snippet });
    expect(response).toEqual('OK');

    url = apiUrl + "/test/1";
    var data = await apiHelper.getData(url);
    expect(data['message']).toEqual("Custom response for 'test' with id:1!");

    return Promise.resolve();
});

itif(process.env.REMOTE !== 'true')('#adapt custom_route', async function () {
    const controller = testHelper.getController();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    const sc = controller.getServerConfig();
    sc['api'] = {
        'timeout': 1000
    };

    const url = apiUrl + "/test/1";
    var err;
    try {
        data = await apiHelper.getData(url);
    } catch (error) {
        err = error;
    }
    expect(err['message']).toEqual('504: Gateway Timeout - ' + url);

    const route = {
        'regex': '^/test/(\\d+)$'
    };
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