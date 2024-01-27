var server = {
    port: 3002,
    ssl: false,
    auth: false,
    fileStorage: [{
        name: "localhost",
        url: "/cdn",
        path: "../cdn/"
    }],
    processManager: null
};

module.exports = server;