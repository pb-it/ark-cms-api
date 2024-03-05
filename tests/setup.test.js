const path = require('path');

const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

xtest('#clear database', async function () {
    await TestHelper.clearDatabase();
    await TestHelper.restart();
    return Promise.resolve();
});

xtest('#create data', async function () {
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    await TestHelper.setupScenario(1); // movie_db

    const urlStudios = apiUrl + "/studios";
    var data = await apiHelper.getData(urlStudios);
    expect(data.length).toEqual(3);

    const studioId = 1;
    const urlSearch = apiUrl + "/movies?studio=" + studioId;
    data = data = await apiHelper.getData(urlSearch);
    var idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3');

    return Promise.resolve();
});

xtest('#backup database', async function () {
    return TestHelper.backup(path.join(__dirname, './tmp/movie-db.sql'));
});

xtest('#restore database', async function () {
    await TestHelper.restore(path.join(__dirname, './tmp/movie-db.sql'));
    await TestHelper.restart();
    return Promise.resolve();
});