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

test('movie_db', async function () {
    const webclient = testHelper.getWebclient();
    const apiUrl = testHelper.getApiUrl();
    const apiHelper = testHelper.getApiHelper();

    await TestHelper.setupModels(apiHelper);

    //insert testdata
    var movie = JSON.parse(fs.readFileSync('./tests/data/crud/movies_1.json', 'utf8'));

    var urlMovies = apiUrl + "/movies";
    await webclient.post(urlMovies, movie);

    data = await apiHelper.getData(urlMovies);
    expect(data.length).toEqual(1);

    var resMovie = data[0];
    var resMovieAll = { ...resMovie };
    var movieId = resMovie['id'];
    delete resMovie['id'];
    delete resMovie['created_at'];
    delete resMovie['updated_at'];
    delete resMovie['studio'];
    delete resMovie['stars'];

    expect(resMovie).toEqual(movie);

    var studio = JSON.parse(fs.readFileSync('./tests/data/crud/studios_1.json', 'utf8'));

    var urlStudios = apiUrl + "/studios";
    await webclient.post(urlStudios, studio);

    data = await apiHelper.getData(urlStudios);
    expect(data.length).toEqual(1);

    var resStudio = data[0];
    var studioId = resStudio['id'];
    delete resStudio['id'];
    delete resStudio['created_at'];
    delete resStudio['updated_at'];
    delete resStudio['movies'];

    expect(resStudio).toEqual(studio);

    var star = JSON.parse(fs.readFileSync('./tests/data/crud/stars_1.json', 'utf8'));

    var urlStars = apiUrl + "/stars";
    await webclient.post(urlStars, star);

    data = await apiHelper.getData(urlStars);
    expect(data.length).toEqual(1);

    var resStar = data[0];
    var starId = resStar['id'];
    delete resStar['id'];
    delete resStar['created_at'];
    delete resStar['updated_at'];
    delete resStar['movies'];

    expect(resStar).toEqual(star);

    //update via relation
    res = await webclient.put(urlStudios + "/" + studioId, { 'movies': [movieId] });
    expect(res['movies'].length).toEqual(1);
    expect(res['movies'][0]['id']).toEqual(movieId);

    data = await apiHelper.getData(urlMovies);
    expect(data.length).toEqual(1);
    res = data[0];
    expect(res['studio']['id']).toEqual(studioId);

    //update(remove) via relation
    res = await webclient.put(urlStudios + "/" + studioId, { 'movies': [] });
    expect(res['movies'].length).toEqual(0);

    //update
    await webclient.put(urlMovies + "/" + movieId, { 'stars': [starId] });

    data = await apiHelper.getData(urlStars);
    expect(data.length).toEqual(1);
    res = data[0];
    expect(res['movies'].length).toEqual(1);
    expect(res['movies'][0]['id']).toEqual(movieId);

    return Promise.resolve();
});