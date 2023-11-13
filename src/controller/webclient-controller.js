const FetchWebClient = require('../common/webclient/fetch-webclient');

class WebClientController {

    _controller;
    _clients;
    _defaultWebClient;

    constructor(controller) {
        this._controller = controller;

        this._clients = {};

        const client = new FetchWebClient();
        const name = client.getName();
        if (name) {
            this._clients[name] = client;
            this._defaultWebClient = client;
        }
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

    addWebClient(client, bDefault) {
        const name = client.getName();
        if (name) {
            this._clients[name] = client;
            if (bDefault)
                this._defaultWebClient = client;
        } else
            throw new Error('Client did not provide a name!');
    }

    setDefaultWebClient(name) {
        const client = this._clients[name];
        if (client)
            this._defaultWebClient = client;
        else
            throw new Error('No client with name \'' + name + '\' found!');
    }
}

module.exports = WebClientController;