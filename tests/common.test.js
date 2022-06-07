const controller = require('../src/controller/controller');
const webclient = require('../src/common/webclient.js');
const fs = require('fs');

beforeAll(async () => {
    const server = require('./config/server');
    const database = require('./config/database');

    return await controller.setup(server, database);
});

afterAll(() => {
    controller.teardown();
});

/*test('company', async function () {
    var model = JSON.parse(fs.readFileSync('./tests/data/models/company.json', 'utf8'));

    const url = "http://localhost:3002/models";

    await webclient.post(url, model);

    var data = await webclient.curl(url);
    delete data[0]['id'];
    expect(data).toEqual([model]);

    return Promise.resolve();
});*/

test.only('media', async function () {
    var model = JSON.parse(fs.readFileSync('./tests/data/models/media.json', 'utf8'));

    var url = "http://localhost:3002/models";
    await webclient.post(url, model);

    var data = await webclient.curl(url);
    var res = data.filter(function (x) {
        return x['name'] === "media";
    })[0];
    delete res['id'];
    expect(res).toEqual(model);

    var create = JSON.parse(fs.readFileSync('./tests/data/create/media1.json', 'utf8'));

    url = "http://localhost:3002/api/media";
    await webclient.post(url, create);

    data = await webclient.curl(url);
    expect(data.length).toEqual(1);

    res = data[0];
    delete res['id'];
    delete res['created_at'];
    delete res['updated_at'];
    delete res['file'];

    var result = JSON.parse(fs.readFileSync('./tests/data/results/media1.json', 'utf8'));
    expect(res).toEqual(result);

    var knex = controller.getKnex();
    try {
        await knex.schema.dropTable('media');
    } catch (err) {
        console.log(err.message);
    }

    return Promise.resolve();
});