var database = {
    defaultConnection: 'default',
    connections: {
        default: {
            connector: 'bookshelf',
            settings: {
                client: 'mysql2',
                connection: {
                    host: 'host.docker.internal',
                    user: 'root',
                    password: '',
                    database: 'cms',
                    charset: 'utf8mb4',
                    connectTimeout: 60000
                },
            },
            options: {}
        }
    }
};

module.exports = database;