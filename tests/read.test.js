const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

test('#read', async function () {
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    await TestHelper.setupScenario(1);

    var urlRead;
    var idArr;

    urlRead = apiUrl + "/stars";
    data = await apiHelper.getData(urlRead);
    expect(data.length).toEqual(7);

    urlRead = apiUrl + "/stars/1";
    data = await apiHelper.getData(urlRead);
    expect(data['id']).toEqual(1);

    urlRead = apiUrl + "/stars/null";
    var err;
    try {
        data = await apiHelper.getData(urlRead);
    } catch (error) {
        err = error;
    }
    expect(err['message']).toEqual('422: Unprocessable Entity - ' + urlRead);

    urlRead = apiUrl + "/stars/count";
    data = await apiHelper.getData(urlRead);
    expect(data).toEqual(7);

    urlRead = apiUrl + "/stars/count?movies=3";
    data = await apiHelper.getData(urlRead);
    expect(data).toEqual(2);

    urlRead = apiUrl + "/stars?_sort=name:asc";
    data = await apiHelper.getData(urlRead);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.join(',')).toEqual('5,2,4,7,3,6,1');

    urlRead = apiUrl + "/stars?_sort=name:desc";
    data = await apiHelper.getData(urlRead);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.join(',')).toEqual('1,6,3,7,4,2,5');

    urlRead = apiUrl + "/stars?_sort=name:asc&_limit=1";
    data = await apiHelper.getData(urlRead);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('5');

    urlRead = apiUrl + "/stars?_sort=name:asc&_limit=1&$field=name";
    data = await apiHelper.getData(urlRead);
    expect(JSON.stringify(data)).toEqual('[{"name":"Arnold Schwarzenegger"}]');

    urlRead = apiUrl + "/stars?_sort=name:asc&_limit=1&$field=id&$field=name";
    data = await apiHelper.getData(urlRead);
    expect(JSON.stringify(data)).toEqual('[{"id":5,"name":"Arnold Schwarzenegger"}]');

    urlRead = apiUrl + "/stars?_sort=name:asc&_limit=1&$field=id,name,movies";
    data = await apiHelper.getData(urlRead);
    expect(JSON.stringify(data)).toEqual('[{"id":5,"name":"Arnold Schwarzenegger","movies":[]}]');

    urlRead = apiUrl + "/stars/5?$field=name";
    data = await apiHelper.getData(urlRead);
    expect(data).toEqual('Arnold Schwarzenegger');

    urlRead = apiUrl + "/stars/5?$field=movies";
    data = await apiHelper.getData(urlRead);
    expect(JSON.stringify(data)).toEqual('[]');

    return Promise.resolve();
});