const TestHelper = require('./helper/test-helper.js');

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    try {
        await testHelper.setup();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
    return Promise.resolve();
}, 10000);

afterAll(async () => {
    return testHelper.teardown();
});

describe("Root Suite", function () {
    require('./common.test.js');
    require('./datatypes.test.js');
    require('./relations.test.js');
    require('./read.test.js');
    require('./search.test.js');
    require('./delete.test.js');
    require('./eval.test.js');
    require('./misc.test.js');
    require('./extensions.test.js');
    require('./auth.test.js');
});