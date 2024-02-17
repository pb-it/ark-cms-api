const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

test('#eval', async function () {
    const controller = testHelper.getController();
    const webclient = testHelper.getWebclient();

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
    var res = response.map((x) => x['id']).join(',')
    expect(res).toEqual('3');
    return Promise.resolve();
});