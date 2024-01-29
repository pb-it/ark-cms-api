var server = {
    port: 3002,
    ssl: true,
    fileStorage: [{
        name: "localhost",
        url: "/cdn",
        path: "../cdn/",
        public: false
    }],
    processManager: null
};

module.exports = server;