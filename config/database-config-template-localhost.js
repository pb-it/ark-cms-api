var database = {
    defaultConnection: 'default',
    connections: {
        default: {
            connector: 'bookshelf',
            settings: {
                client: 'mysql2',
                connection: {
                    host: 'localhost',
                    user: 'root',
                    password: '',
                    database: 'cms',
                    charset: 'utf8mb4'
                },
            },
            options: {}
        }
    }
};

module.exports = database;