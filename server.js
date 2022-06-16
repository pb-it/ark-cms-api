const server = require('./config/server');
const database = require('./config/database');

const controller = require('./src/controller/controller');
controller.setup(server, database);