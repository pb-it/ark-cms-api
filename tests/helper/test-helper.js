
const fs = require('fs');

class TestHelper {

    static async setupModels(apiHelper) {
        var modelMovies = JSON.parse(fs.readFileSync('./tests/data/models/movies.json', 'utf8'));
        await apiHelper.uploadModel(modelMovies);

        var modelStudios = JSON.parse(fs.readFileSync('./tests/data/models/studios.json', 'utf8'));
        await apiHelper.uploadModel(modelStudios);

        var modelStars = JSON.parse(fs.readFileSync('./tests/data/models/stars.json', 'utf8'));
        await apiHelper.uploadModel(modelStars);

        const shelf = controller.getShelf();
        await shelf.loadAllModels();
        await shelf.initAllModels();

        var data = await apiHelper.getAllModels();

        var res = data.filter(function (x) {
            return x['definition']['name'] === "movies";
        })[0];
        var modelMoviesId = res['id'];
        expect(res['definition']).toEqual(modelMovies);

        res = data.filter(function (x) {
            return x['definition']['name'] === "studios";
        })[0];
        var modelStudiosId = res['id'];
        expect(res['definition']).toEqual(modelStudios);

        res = data.filter(function (x) {
            return x['definition']['name'] === "stars";
        })[0];
        var modelStarsId = res['id'];
        expect(res['definition']).toEqual(modelStars);
    }

    static async setupData(apiHelper) {
        const apiUrl = apiHelper.getUrl();
        const webclient = apiHelper.getWebClient();
        var studios = JSON.parse(fs.readFileSync('./tests/data/crud/studios_2.json', 'utf8'));

        var urlStudios = apiUrl + "/studios";
        for (var studio of studios) {
            await webclient.post(urlStudios, studio);
        }

        var data = await apiHelper.getData(urlStudios);
        expect(data.length).toEqual(studios.length);

        var movies = JSON.parse(fs.readFileSync('./tests/data/crud/movies_2.json', 'utf8'));

        var urlMovies = apiUrl + "/movies";
        for (var movie of movies) {
            await webclient.post(urlMovies, movie);
        }

        data = data = await apiHelper.getData(urlMovies);
        expect(data.length).toEqual(movies.length);

        var stars = JSON.parse(fs.readFileSync('./tests/data/crud/stars_2.json', 'utf8'));

        var urlStars = apiUrl + "/stars";
        for (var star of stars) {
            await webclient.post(urlStars, star);
        }

        data = data = await apiHelper.getData(urlStars);
        expect(data.length).toEqual(stars.length);

        return Promise.resolve();
    }
}

module.exports = TestHelper;