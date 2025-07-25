const fs = require('fs');

const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper) {
        global.testHelper = new TestHelper();
        //testHelper._bCleanupAfterTests = false;
    }
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
    var orig = await webclient.post(url, data);

    var response = await apiHelper.getData(url);
    expect(response.length).toEqual(1);
    var res = response[0];
    expect(res).toEqual(orig);

    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];
    delete res['string'];
    delete res['url'];
    delete res['timestamp'];
    delete res['datetime'];

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
    delete res['timestamp'];
    delete res['datetime'];

    expect(res).toEqual(data);

    tmp = await apiHelper.getData(url);
    expect(tmp.length).toEqual(2);

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

    tmp = await apiHelper.getData(url);
    expect(tmp.length).toEqual(2);

    return Promise.resolve();
});

test('#empty json', async function () {
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var tmp = {
        'json': '[1,2]'
    }
    var url = apiUrl + "/misc";
    res = await webclient.post(url, tmp);
    expect(JSON.stringify(res['json'])).toEqual('[1,2]');

    tmp = {
        'json': null
    }
    url = apiUrl + "/misc/" + res['id'];
    res = await webclient.put(url, tmp);
    expect(res['json']).toEqual(null);

    res = await apiHelper.getData(url);
    expect(res['json']).toEqual(null);

    return Promise.resolve();
});