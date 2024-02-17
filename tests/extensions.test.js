const path = require('path');
const fs = require('fs');

const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

test('youtube', async function () {
    //jest.setTimeout(30000);
    const controller = testHelper.getController();
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var model = JSON.parse(fs.readFileSync('./tests/data/models/youtube.json', 'utf8'));

    await apiHelper.uploadModel(model);

    const sc = controller.getServerConfig();
    const rootUrl = (sc['ssl'] ? "https" : "http") + "://localhost:" + sc['port'];
    var urlInfo = rootUrl + "/sys/info";
    var data = await webclient.get(urlInfo);
    if (data['state'] === 'openRestartRequest') {
        const urlRestart = rootUrl + "/sys/restart";
        data = await webclient.get(urlRestart); //TODO: find server restart procedure without terminating test through process.exit()
        await new Promise(r => setTimeout(r, 5000));
    }

    /*var p = 'ytdl-core';
    var resolved = require.resolve(p);
    if (resolved)
        delete require.cache[p];

    const serverConfig = controller.getServerConfig();
    const databaseConfig = controller.getDatabaseConfig();
    await controller.shutdown();
    await controller.setup(serverConfig, databaseConfig);
    await testHelper.init(controller);*/

    var video = JSON.parse(fs.readFileSync('./tests/data/crud/youtube_1.json', 'utf8'));

    var url = apiUrl + "/youtube";
    var res = await webclient.post(url, video);
    var file = 'dQw4w9WgXcQ.mp4';
    expect(res['video']).toEqual(file);
    var fPath = testHelper.getCdn() + "/" + file;
    expect(fs.existsSync(fPath)).toEqual(true);

    var idUrl = url + '/' + res['id'];
    await webclient.delete(idUrl);
    data = await apiHelper.getData(url);
    expect(data.length).toEqual(0);
    expect(fs.existsSync(fPath)).toEqual(false);

    return Promise.resolve();
}, 60000);