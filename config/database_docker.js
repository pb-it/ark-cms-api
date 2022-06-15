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
                    database: 'xcms',
                    charset: 'utf8mb4'
                },
            },
            options: {}
        }
    }
};

module.exports = database;