const path = require('path');
const fs = require('fs');

const Controller = require('./src/controller/controller');

async function main() {
    try {
        const serverConfigPath = path.join(__dirname, './config/server-config.js');
        const serverConfigtemplatePath = path.join(__dirname, './config/server-config-template.js');
        const databaseConfigPath = path.join(__dirname, './config/database-config.js');
        const databaseConfigtemplatePath = path.join(__dirname, './config/database-config-template-localhost.js');
        if (!fs.existsSync(serverConfigPath) && fs.existsSync(serverConfigtemplatePath))
            fs.copyFileSync(serverConfigtemplatePath, serverConfigPath);
        if (!fs.existsSync(databaseConfigPath) && fs.existsSync(databaseConfigtemplatePath))
            fs.copyFileSync(databaseConfigtemplatePath, databaseConfigPath);
        global.controller = new Controller();
        await controller.setup(require(serverConfigPath), require(databaseConfigPath));
    } catch (error) {
        console.error(error);
    }
    return Promise.resolve();
}

main();