const itif = (name, condition, cb) => {
    it(name, async () => {
        try {
            if (await condition()) {
                await cb();
            } else {
                console.warn(`[skipped]: ${name}`);
                done();
            }
            return Promise.resolve();
        } catch (error) {
            //console.error(error);
            return Promise.reject(error);
        }
    });
};

const path = require('path');
const fs = require('fs');

const common = require('../src/common/common.js');
const TestHelper = require('./helper/test-helper');

async function isCurlAvailable() {
    var version;
    try {
        version = await common.exec('curl --version');
        //console.log(version);
    } catch (error) {
        ;
    }
    return version != null;
}

beforeAll(async () => {
    if (!global.testHelper)
        global.testHelper = new TestHelper();
    return testHelper.setup();
});

afterAll(async () => {
    return testHelper.teardown();
});

/**
 * webclient
 */
xtest('#backup database', async function () {
    return TestHelper.backup(path.join(__dirname, './tmp/dump.sql'));
});

/**
 * curl
 */
itif('#backup database (curl)', isCurlAvailable, async function () {
    const file = path.join(__dirname, './tmp/dump.sql');
    if (fs.existsSync(file))
        fs.unlinkSync(file);
    var bAuth;
    const controller = testHelper.getController();
    if (controller) {
        const serverConfig = controller.getServerConfig();
        bAuth = serverConfig['auth'];
    } else {
        const testConfig = testHelper.getTestConfig();
        if (testConfig['remote'])
            bAuth = testConfig['remote']['auth'];
    }
    console.log('bAuth: ' + bAuth);
    const host = testHelper.getHost();
    if (bAuth) {
        var cmd = 'curl -k ' + host + '/sys/tools/db/backup -o ./tests/tmp/dump.sql -w "%{http_code}"';
        var res = await common.exec(cmd);
        expect(res).toEqual('401');

        cmd = 'curl -k -c cookies.txt -d "user=admin&pass=admin" ' + host + '/sys/auth/login';
        res = await common.exec(cmd);
        cmd = 'curl -k -b cookies.txt ' + host + '/sys/tools/db/backup -o ./tests/tmp/dump.sql --fail -w "%{http_code}"';
        res = await common.exec(cmd);
        expect(res).toEqual('200');
        fs.rmSync(path.join(__dirname, '../cookies.txt'));
    } else {
        var cmd = 'curl -k ' + host + '/sys/tools/db/backup -o ./tests/tmp/dump.sql --fail -w "%{http_code}"';
        var res = await common.exec(cmd);
        expect(res).toEqual('200');
    }
    expect(fs.existsSync(file)).toEqual(true);
    return Promise.resolve();
});