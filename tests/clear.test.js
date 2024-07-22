const TestHelper = require('./helper/test-helper');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

test('#clear database', async function () {
    await TestHelper.clearDatabase();
    await TestHelper.restart();
    return Promise.resolve();
});