const fs = require('fs');

const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper) {
        global.testHelper = new TestHelper();
        testHelper._bCleanupAfterTests = false;
    }
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

test('#basic', async function () {
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    //await TestHelper.setupScenario(1);

    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?id_in=1,3,5";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,3,5');

    urlSearch = apiUrl + "/stars?id_in=3,[object%20Object]";
    var err;
    try {
        data = await apiHelper.getData(urlSearch);
    } catch (error) {
        err = error;
    }
    expect(err['message']).toEqual('422: Unprocessable Entity - ' + urlSearch);

    urlSearch = apiUrl + "/stars?id_nin=1,3,5";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2,4,6,7');

    urlSearch = apiUrl + "/stars?name_eq=Johnny Depp";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    urlSearch = apiUrl + "/stars?name_contains=Chris";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/stars?_limit=3";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3');

    urlSearch = apiUrl + "/stars?created_at_lt=" + new Date().toISOString();
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3,4,5,6,7');

    return Promise.resolve();
});

test('#timestamp/datetime', async function () {
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    const model = JSON.parse(fs.readFileSync('./tests/data/models/misc.json', 'utf8'));
    const id = await apiHelper.uploadModel(model);

    const datetime = new Date().toISOString();
    var tmp = {
        'timestamp': datetime,
        'datetime': datetime
    }
    const url = apiUrl + "/misc";
    res = await webclient.post(url, tmp);
    /*const resDatetime = res['datetime'];
    console.log(datetime);
    console.log(resDatetime);
    console.log('Diff: ' + (new Date(datetime) - new Date(resDatetime)));*/
    expect(res['timestamp']).toEqual(datetime);
    expect(res['datetime']).toEqual(datetime);

    var data = await apiHelper.getData(url);
    expect(data[data.length - 1]).toEqual(res);

    var urlSearch = apiUrl + "/misc?timestamp_eq=" + datetime;
    data = await apiHelper.getData(urlSearch);
    expect(data.length).toEqual(1);
    expect(data[0]).toEqual(res);

    urlSearch = apiUrl + "/misc?timestamp=" + datetime;
    data = await apiHelper.getData(urlSearch);
    expect(data.length).toEqual(1);
    expect(data[0]).toEqual(res);

    urlSearch = apiUrl + "/misc?timestamp=" + datetime.substring(0, datetime.indexOf('.')) + "Z";
    data = await apiHelper.getData(urlSearch);
    expect(data.length).toEqual(1);
    expect(data[0]).toEqual(res);

    urlSearch = apiUrl + "/misc?datetime_eq=" + datetime;
    data = await apiHelper.getData(urlSearch);
    expect(data.length).toEqual(1);
    expect(data[0]).toEqual(res);

    urlSearch = apiUrl + "/misc?datetime=" + datetime;
    data = await apiHelper.getData(urlSearch);
    expect(data.length).toEqual(1);
    expect(data[0]).toEqual(res);

    urlSearch = apiUrl + "/misc?datetime=" + datetime.substring(0, datetime.indexOf('.')) + "Z";
    data = await apiHelper.getData(urlSearch);
    expect(data.length).toEqual(1);
    expect(data[0]).toEqual(res);

    return Promise.resolve();
});

test('#relations', async function () {
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?movies_null=true";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('5');

    urlSearch = apiUrl + "/stars?movies=3";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_any=3";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_any=3&id_nin=1";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/stars?movies_any=1,3";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_every=1,3";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1');

    urlSearch = apiUrl + "/stars?movies_none=3";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3,4,5,6,7');

    urlSearch = apiUrl + "/stars?movies_count_lte=1";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3,4,5,6,7');

    urlSearch = apiUrl + "/stars?movies_count_gt=1";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_count_gt=1&_limit=-1";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_count_gt=1&gender=male";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?gender=male&movies_count_gt=1";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2');

    urlSearch = apiUrl + "/stars?movies_count_lt=2&gender=male";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3,4,5');

    return Promise.resolve();
});

test('#relation_via', async function () {
    // aggregation via foreign single-relation

    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/studios?movies_null=false";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,3');

    urlSearch = apiUrl + "/studios?movies_null=true";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/studios?movies_count=0";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/studios?movies_count=1";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    urlSearch = apiUrl + "/studios?movies_count=2";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('');

    urlSearch = apiUrl + "/studios?movies_count=3";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1');

    urlSearch = apiUrl + "/studios?movies_count_lt=2";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2,3');

    urlSearch = apiUrl + "/studios?movies_count_gte=0";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3');

    urlSearch = apiUrl + "/studios?movies_count_gte=2";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1');

    urlSearch = apiUrl + "/studios?movies=4";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    urlSearch = apiUrl + "/studios?movies_any=2,4";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,3');

    urlSearch = apiUrl + "/studios?movies_none=2";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2,3');

    urlSearch = apiUrl + "/studios?movies_none=2,4";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('2');

    urlSearch = apiUrl + "/studios?movies_every=1,2,3";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1');

    urlSearch = apiUrl + "/studios?movies_every=1,2,4";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('');

    urlSearch = apiUrl + "/studios?movies_every=4";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('3');

    return Promise.resolve();
});

test('#multiple_and', async function () {
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?gender=female&movies_null=true";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('');

    urlSearch = apiUrl + "/movies?studio_null=false&stars_null=false";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,3,4');

    return Promise.resolve();
});

test('#multiple_or', async function () {
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var urlSearch;
    var idArr;

    urlSearch = apiUrl + "/stars?[$or][movies]=3&[$or][movies_null]=true";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,5');

    /*urlSearch = apiUrl + "/stars?[or][0][movies]=3&[or][1][movies_null]=true";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('1,2,5');*/

    return Promise.resolve();
});

test('#multiple_mix', async function () {
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    var urlSearch;
    var idArr;

    //  female && null || 5 -> zero female without movies; two actors with movie 5
    urlSearch = apiUrl + "/stars?gender=female&movies_null=true&[$or][movies]=5";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,7');

    // same with parentheses -> ( female && null ) || 5
    urlSearch = apiUrl + "/stars?[$or][$and][gender]=female&[$or][$and][movies_null]=true&[$or][movies]=5";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,7');

    // same with switched order ->  5 || ( female && null )
    urlSearch = apiUrl + "/stars?[$or][movies]=5&[$or][$and][gender]=female&[$or][$and][movies_null]=true";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('4,7');

    // female && ( null || 5 )
    urlSearch = apiUrl + "/stars?gender=female&[$or][movies_null]=true&[$or][movies]=5";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('7');

    /*urlSearch = apiUrl + "/stars?gender=female&[or][0][movies_null]=true&[or][1][movies]=5";
    data = await apiHelper.getData(urlSearch);
    idArr = data.map(function (x) { return x['id'] });
    expect(idArr.sort().join(',')).toEqual('7');*/

    return Promise.resolve();
});