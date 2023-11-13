class WebClient {

    _name;

    constructor(name) {
        if (this.constructor == WebClient)
            throw new Error("Can't instantiate abstract class!");
        this._name = name;
    }

    getName() {
        return this._name;
    }

    async get(url, options) {
        throw new Error("Abstract method!");
    }

    async post(url, data, options) {
        throw new Error("Abstract method!");
    }

    async put(url, data, options) {
        throw new Error("Abstract method!");
    }

    async delete(url) {
        throw new Error("Abstract method!");
    }

    async request(url, method, data, options) {
        throw new Error("Abstract method!");
    }

    async getBase64(url) {
        throw new Error("Abstract method!");
    }

    async download(url, file) {
        throw new Error("Abstract method!");
    }
}

module.exports = WebClient;