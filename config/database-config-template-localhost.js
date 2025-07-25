var database = {
    defaultConnection: 'localhost',
    connections: {
        localhost: {
            connector: 'bookshelf',
            settings: {
                client: 'mysql2',
                connection: {
                    host: 'localhost',
                    user: 'root',
                    password: '',
                    database: 'cms',
                    //multipleStatements: true,
                    //timezone: 'Z',
                    //dateStrings: true,
                    charset: 'utf8mb4'
                }
            },
            options: {}
        }
    }
};

module.exports = database;