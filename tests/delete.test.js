const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

test('#movie_db', async function () {
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();
    const databaseHelper = testHelper.getDatabaseHelper();

    const models = await apiHelper.getModel();
    for (var model of models)
        await databaseHelper.deleteModel(model);
    await TestHelper.setupModels(apiHelper);
    await TestHelper.setupData(apiHelper);
    var urlStudios = apiUrl + "/studios";

    data = await apiHelper.getData(urlStudios);
    expect(data.length).toEqual(3);

    var studioId = 1;
    var urlSearch = apiUrl + "/movies?studio=" + studioId;
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3');

    var res = await webclient.delete(urlStudios + "/" + studioId);
    data = await apiHelper.getData(urlStudios);
    expect(data.length).toEqual(2);

    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('');

    urlSearch = apiUrl + "/movies?studio=3";
    data = data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4');

    return Promise.resolve();
});