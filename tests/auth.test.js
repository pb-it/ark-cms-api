const fetch = require('cross-fetch');
const itif = (condition) => condition ? it : it.skip;

const TestHelper = require('./helper/test-helper.js');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

itif(process.env.REMOTE !== 'true')('basic auth', async function () {
    const controller = testHelper.getController();
    const apiUrl = testHelper.getApiUrl();

    const serverConfig = controller.getServerConfig();
    const databaseConfig = controller.getDatabaseConfig();
    if (!serverConfig['auth']) {
        await controller.shutdown();
        const sConfig = { ...serverConfig };
        sConfig['auth'] = true;
        await controller.setup(sConfig, databaseConfig);
        await testHelper.init(controller);
    }
    var response = await fetch(apiUrl + '/_model');
    expect(response.status).toEqual(401);
    var text = await response.text();
    expect(text).toEqual('Unauthorized');

    const headers = new Headers();
    const username = 'admin';
    const password = 'admin';
    headers.set('Authorization', 'Basic ' + Buffer.from(username + ":" + password).toString('base64'));
    response = await fetch(apiUrl + '/_model', {
        headers: headers
    });
    expect(response.status).toEqual(200);
    text = await response.text();
    //console.log(text);
    expect(text).not.toEqual('Unauthorized');

    response = await fetch(apiUrl + '/_model');
    expect(response.status).toEqual(401);
    var text = await response.text();
    expect(text).toEqual('Unauthorized');

    response = await fetch(apiUrl + '/_model', {
        credentials: 'include'
    });
    expect(response.status).toEqual(401);
    var text = await response.text();
    expect(text).toEqual('Unauthorized');

    await controller.shutdown();
    await controller.setup(serverConfig, databaseConfig);
    await testHelper.init(controller);

    return Promise.resolve();
}, 10000);