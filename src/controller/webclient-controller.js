const WebClient = require('../common/webclient');

class WebClientController {

    _controller;
    _clients;
    _defaultWebClient;

    constructor(controller) {
        this._controller = controller;

        this._defaultWebClient = new WebClient();
        this._clients = {
            'fetch': this._defaultWebClient
        };
    }

    getAvailableWebClients() {
        return Object.keys(this._clients);
    }

    getWebClient(name) {
        var client;
        if (name)
            client = this._clients[name];
        else
            client = this._defaultWebClient;
        return client;
    }

    addWebClient(name, client, bDefault) {
        this._clients[name] = client;
        if (bDefault)
            this._defaultWebClient = client;
    }

    setDefaultWebClient(name) {
        this._defaultWebClient = this._clients[name];
    }
}

module.exports = WebClientController;