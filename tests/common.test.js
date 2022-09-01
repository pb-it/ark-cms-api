if (!global.controller)
    global.controller = require('../src/controller/controller');
const webclient = require('../src/common/webclient.js');
const fs = require('fs');

const modelsUrl = "http://localhost:3002/api/_model";
const modelsUrlPut = modelsUrl + "?v=0.3.0-beta";
const apiUrl = "http://localhost:3002/api";
var knex;
var shelf;
const bCleanupBeforeTests = false;
const bCleanupAfterTest = false;

beforeAll(async () => {
    if (!controller.isRunning()) {
        const server = require('./config/server-config');
        const database = require('./config/database-config');
        await controller.setup(server, database);
        knex = controller.getKnex();
        shelf = controller.getShelf();
    }

    if (bCleanupBeforeTests)
        ; //TODO:

    return Promise.resolve();
});

afterAll(async () => {
    controller.teardown();
    return new Promise(r => setTimeout(r, 2000));
});

test('media', async function () {
    var model = JSON.parse(fs.readFileSync('./tests/data/models/media.json', 'utf8'));

    await webclient.put(modelsUrlPut, model);

    var data = await webclient.curl(modelsUrl);
    var res = data.filter(function (x) {
        return x['definition']['name'] === "media";
    })[0];
    var modelId = res['id'];
    expect(res['definition']).toEqual(model);

    var media = JSON.parse(fs.readFileSync('./tests/data/crud/media_1.json', 'utf8'));

    var url = apiUrl + "/media";
    await webclient.post(url, media);

    data = await webclient.curl(url);
    expect(data.length).toEqual(1);

    res = data[0];
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];
    delete res['file'];

    expect(res).toEqual(media);

    if (bCleanupAfterTest) {
        await shelf.deleteModel(modelId);
        data = await webclient.curl(modelsUrl);
        res = data.filter(function (x) {
            return x['definition']['name'] === "media";
        });
        expect(res.length).toEqual(0);

        try {
            await knex.schema.dropTable('media');
        } catch (err) {
            console.log(err.message);
        }
    }
    return Promise.resolve();
});

test('snippets', async function () {
    var model = JSON.parse(fs.readFileSync('./tests/data/models/snippets.json', 'utf8'));

    await webclient.put(modelsUrlPut, model);

    var data = await webclient.curl(modelsUrl);
    var res = data.filter(function (x) {
        return x['definition']['name'] === "snippets";
    })[0];
    var modelId = res['id'];
    expect(res['definition']).toEqual(model);

    var snippet = JSON.parse(fs.readFileSync('./tests/data/crud/snippets_1.json', 'utf8'));

    var url = apiUrl + "/snippets";
    await webclient.post(url, snippet);

    data = await webclient.curl(url);
    expect(data.length).toEqual(1);

    res = data[0];
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];

    expect(res).toEqual(snippet);

    snippet = JSON.parse(fs.readFileSync('./tests/data/crud/snippets_2.json', 'utf8'));
    await webclient.post(url, snippet);

    if (bCleanupAfterTest) {
        await shelf.deleteModel(modelId);
        data = await webclient.curl(modelsUrl);
        res = data.filter(function (x) {
            return x['definition']['name'] === "snippets";
        });
        expect(res.length).toEqual(0);

        try {
            await knex.schema.dropTable('snippets');
        } catch (err) {
            console.log(err.message);
        }
    }
    return Promise.resolve();
});