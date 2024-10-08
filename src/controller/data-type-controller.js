class DataTypeController {

    _controller;

    _store;

    constructor(controller) {
        this._controller = controller;
    }

    addDataType(type) {
        if (!this._store)
            this._store = {};
        var tag = type['tag'];
        if (tag)
            this._store[tag] = type;
    }

    getDataType(tag) {
        var res;
        if (this._store) {
            if (tag)
                res = this._store[tag];
            else
                res = this._store;
        }
        return res;
    }

    async initAllModels() {
        const models = controller.getShelf().getModel();
        if (models) {
            for (var m of models) {
                if (m.initDone())
                    m.initCustomDataTypes();
            }
        }
        return Promise.resolve();
    }
}

module.exports = DataTypeController;