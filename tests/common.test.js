const fs = require('fs');
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

/**
 * url & base64
 */
test('media', async function () {
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var model = JSON.parse(fs.readFileSync('./tests/data/models/media.json', 'utf8'));

    await apiHelper.uploadModel(model);

    var data = await apiHelper.getModel();
    var res = data.filter(function (x) {
        return x['definition']['name'] === "media";
    })[0];
    var modelId = res['id'];
    expect(res['definition']).toEqual(model);

    var media = JSON.parse(fs.readFileSync('./tests/data/crud/media_1.json', 'utf8'));
    var base64 = await webclient.getBase64(media['url']);
    //media['base64'] = { 'base64': base64 };
    media['base64'] = { 'url': media['url'] };
    /*await fetch(url)
        .then((response) => response.buffer())
        .then((buffer) => {
            const b64 = buffer.toString('base64');
            return b64;
        })
        .catch(console.error);*/

    var url = apiUrl + "/media";
    await webclient.post(url, media);

    data = await apiHelper.getData(url);
    expect(data.length).toEqual(1);

    expect(data[0]['base64']).toEqual(base64);

    return Promise.resolve();
});

test('files', async function () {
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var fPath = testHelper.getCdn() + '/Testbild.png';
    if (fs.existsSync(fPath))
        fs.unlinkSync(fPath);

    var model = JSON.parse(fs.readFileSync('./tests/data/models/files.json', 'utf8'));

    await apiHelper.uploadModel(model);

    var data = await apiHelper.getModel();
    var res = data.filter(function (x) {
        return x['definition']['name'] === "files";
    })[0];
    var modelId = res['id'];
    expect(res['definition']).toEqual(model);

    var fData = JSON.parse(fs.readFileSync('./tests/data/crud/files_1.json', 'utf8'));

    var url = apiUrl + "/files";
    await webclient.post(url, fData);

    data = await apiHelper.getData(url);
    expect(data.length).toEqual(1);

    var file = data[0]['file'];
    fPath = testHelper.getCdn() + "/" + file;
    expect(fs.existsSync(fPath)).toEqual(true);

    fs.unlinkSync(fPath);

    return Promise.resolve();
});

/**
 * mostly tests for testing visual representation of data after test run
 */
test('snippets', async function () {
    //jest.setTimeout(30000);

    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var model = JSON.parse(fs.readFileSync('./tests/data/models/snippets.json', 'utf8'));

    var id = await apiHelper.uploadModel(model);

    var data = await apiHelper.getModel();
    var res = data.filter(function (x) {
        return x['definition']['name'] === "snippets";
    })[0];
    var modelId = res['id'];
    expect(res['definition']).toEqual(model);

    // 1
    var snippet = JSON.parse(fs.readFileSync('./tests/data/crud/snippets_1.json', 'utf8'));

    var url = apiUrl + "/snippets";
    await webclient.post(url, snippet);

    data = await apiHelper.getData(url);
    expect(data.length).toEqual(1);

    res = data[0];
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];

    expect(res).toEqual(snippet);

    // 2
    snippet = JSON.parse(fs.readFileSync('./tests/data/crud/snippets_2.json', 'utf8'));
    await webclient.post(url, snippet);

    // 3
    //jest.spyOn(console, 'error').mockImplementation(() => { });
    snippet = JSON.parse(fs.readFileSync('./tests/data/crud/snippets_3.json', 'utf8'));
    //expect(async () => { return webclient.post(url, snippet); }).toThrow(Error);
    var err;
    try {
        res = await webclient.post(url, snippet);
    } catch (error) {
        err = error;
    }
    expect(err['message']).toEqual('500: Internal Server Error - ' + url);
    expect(err['response']['body']).toEqual('[knex] ER_TRUNCATED_WRONG_VALUE_FOR_FIELD');

    await apiHelper.deleteModel(id);

    model['charEncoding'] = 'utf8mb4';
    await apiHelper.uploadModel(model);

    //await sleep(1000);

    res = await webclient.post(url, snippet);
    var id = res['id'];

    res = await apiHelper.getData(url + "/" + id);
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];

    expect(res).toEqual(snippet);

    return Promise.resolve();
});