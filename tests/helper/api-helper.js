class ApiHelper {

    _api;
    _webclient;
    _modelsUrl;
    _modelsUrlPut;

    constructor(api, webclient) {
        this._api = api;
        this._webclient = webclient;
        this._modelsUrl = this._api + "/_model";
        const appVersion = controller.getVersionController().getPkgVersion();
        this._modelsUrlPut = this._modelsUrl + "?v=" + appVersion;
    }

    getUrl() {
        return this._api;
    }

    getWebClient() {
        return this._webclient;
    }

    async getData(url) {
        var data;
        var response = await this._webclient.get(url);
        if (response && response['data'])
            data = response['data'];
        return Promise.resolve(data);
    }

    async getModel(id) {
        var url = this._modelsUrl;
        if (id)
            url += '/' + id;
        return this.getData(url);
    }

    async uploadModel(model) {
        var id;
        try {
            id = await this._webclient.put(this._modelsUrlPut, model);
        } catch (error) {
            console.log(error);
            var msg;
            if (error['message']) {
                msg = error['message'];
                if (error['response'] && error['response']['data'])
                    msg += ": " + error['response']['data'];
            }

            if (msg)
                throw new Error(msg);
            else
                throw error;
        }
        return Promise.resolve(id);
    }
}

module.exports = ApiHelper;