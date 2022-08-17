const path = require('path');
const fs = require('fs');

global.controller = require('./src/controller/controller');

const serverConfigPath = path.join(__dirname, './config/server-config.js');
const serverConfigtemplatePath = path.join(__dirname, './config/server-config-template.js');
const databaseConfigPath = path.join(__dirname, './config/database-config.js');
const databaseConfigtemplatePath = path.join(__dirname, './config/database-config-template.js');
if (!fs.existsSync(serverConfigPath) && fs.existsSync(serverConfigtemplatePath))
    fs.copyFileSync(serverConfigtemplatePath, serverConfigPath);
if (!fs.existsSync(databaseConfigPath) && fs.existsSync(databaseConfigtemplatePath))
    fs.copyFileSync(databaseConfigtemplatePath, databaseConfigPath);
controller.setup(require(serverConfigPath), require(databaseConfigPath));