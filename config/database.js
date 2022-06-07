var database = {
    defaultConnection: 'default',
    connections: {
        default: {
            connector: 'bookshelf',
            settings: {
                client: 'mysql',
                connection: {
                    host: 'localhost',
                    user: 'root',
                    password: '',
                    database: 'xcms',
                    charset: 'utf8mb4'
                },
            },
            options: {}
        }
    }
};

module.exports = database;