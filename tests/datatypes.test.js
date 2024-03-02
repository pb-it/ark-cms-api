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

test('#json', async function () {
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    const model = JSON.parse(fs.readFileSync('./tests/data/models/misc.json', 'utf8'));
    const id = await apiHelper.uploadModel(model);

    const obj = [1, 2];
    const data = {
        'json': obj
    }
    const url = apiUrl + "/misc";
    res = await webclient.post(url, data);

    var response = await apiHelper.getData(url);
    expect(response.length).toEqual(1);
    expect(response[0]).toEqual(res);

    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];
    delete res['string'];
    delete res['url'];

    expect(res).toEqual(data);

    var tmp = {
        'json': JSON.stringify(obj)
    }
    res = await webclient.post(url, tmp);

    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];
    delete res['string'];
    delete res['url'];

    expect(res).toEqual(data);

    tmp = {
        'json': '[1,2'
    }
    res = null;
    try {
        res = await webclient.post(url, tmp);
    } catch (error) {
        res = error['response'];
    }
    expect(res['status']).toEqual(500);
    expect(res['body']).toEqual('[knex] ER_INVALID_JSON_TEXT');

    return Promise.resolve();
});