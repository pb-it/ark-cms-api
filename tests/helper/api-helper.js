class ApiHelper {

    _api;
    _modelsUrl;
    _modelsUrlPut;

    constructor(api, webclient) {
        this._api = api;
        this._webclient = webclient;
        this._modelsUrl = this._api + "/_model";
        this._modelsUrlPut = this._modelsUrl + "?v=0.4.0-beta";
    }

    async getAllModels() {
        return await this._webclient.curl(this._modelsUrl);
    }

    async uploadModel(model) {
        var def;
        try {
            var res = await this._webclient.put(this._modelsUrlPut, model);
            def = { 'id': res['data'], 'definition': JSON.parse(res['config']['data']) };
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
        return Promise.resolve(def);
    }
}

module.exports = ApiHelper;