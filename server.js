const server = require('./config/server-config');
const database = require('./config/database-config');

const controller = require('./src/controller/controller');
controller.setup(server, database);