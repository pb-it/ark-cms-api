const Logger = require('../common/logger/logger');
const controller = require('../controller/controller');
const Model = require('./model');

class Shelf {

    _knex;
    _bookshelf;

    _models;

    constructor(knex) {
        this._knex = knex;
        this._bookshelf = require('bookshelf')(this._knex);
    }

    async initShelf() {
        var definition = {
            "name": "_model",
            "options": {
                "increments": true,
                "timestamps": false
            },
            "attributes": [
                {
                    "name": "definition",
                    "dataType": "json"
                }
            ]
        }
        var mModel = new Model(this, null, definition);
        await mModel.initModel(); // creates model database if not exists
        await this.loadAllModels();
        if (!this.getModel('_model')) {
            await this.upsertModel(null, definition, false);
            this._models.push(mModel);
        }

        if (!this.getModel('_change')) {
            definition = {
                "name": "_change",
                "options": {
                    "increments": true,
                    "timestamps": false
                },
                "attributes": [
                    {
                        "name": "timestamp",
                        "dataType": "timestamp",
                        "required": true,
                        "defaultValue": "CURRENT_TIMESTAMP"
                    },
                    {
                        "name": "method",
                        "dataType": "string"
                    },
                    {
                        "name": "model",
                        "dataType": "string"
                    },
                    {
                        "name": "record_id",
                        "dataType": "integer"
                    },
                    {
                        "name": "data",
                        "dataType": "json"
                    }
                ]
            }
            await this.upsertModel(null, definition);
        }
        return Promise.resolve();
    }

    getKnex() {
        return this._knex;
    }

    getBookshelf() {
        return this._bookshelf;
    }

    async loadAllModels() {
        this._models = [];

        var dataset = await this._knex('_model').select('id', 'definition');
        var def;
        var definition;
        var model;
        for (const row of dataset) {
            def = row['definition'];
            if (typeof def === 'object') //mysql2
                definition = def;
            else if (typeof def === 'string' || def instanceof String) //mysql
                definition = JSON.parse(def);
            model = new Model(this, row['id'], definition);
            this._models.push(model);
        }
        return Promise.resolve();
    }

    async initAllModels() {
        if (this._models) {
            for (var m of this._models) {
                if (!m.initDone()) {
                    try {
                        await m.initModel();
                    } catch (error) {
                        Logger.parseError(error);
                    }
                }
            }
        }
        return Promise.resolve();
    }

    async upsertModel(id, definition, bInit = true) {
        var name = definition['name'];
        Logger.info('[App] Creating or updating model \'' + name + '\'');

        var model;
        if (this._models) {
            if (id) {
                for (var m of this._models) {
                    if (m.getId() == id) {
                        if (m.getName() !== definition['name'])
                            throw new Error('Renaming models not supported');
                        model = m;
                        break;
                    }
                }
            } else {
                for (var m of this._models) {
                    if (m.getName() === name) {
                        model = m;
                        id = model.getId();
                        break;
                    }
                }
            }
        }

        var res;
        if (id) {
            res = await this._knex('_model').where('id', id); //.count('*');
            if (res.length == 1)  //var count = res[0]['count(*)'];
                res = await this._knex('_model').where('id', id).update({ 'definition': JSON.stringify(definition) });
            else
                throw new Error();
        } else {
            res = await this._knex('_model').insert({ 'definition': JSON.stringify(definition) });
            id = res[0];

            //res = await this._knex('_model').select('id').where('name', name);
            //id = res[0]['id'];
        }

        if (model)
            model.setDefinition(definition);
        else {
            model = new Model(this, id, definition);
            if (this._models)
                this._models.push(model);
            else
                this._models = [model];
        }
        if (bInit)
            await model.initModel();

        return Promise.resolve(model);
    }

    async deleteModel(id) {
        var name;
        await this._knex('_model').where('id', id).delete();
        var models = [];
        for (var model of this._models) {
            if (model.getId() == id)
                name = model.getName();
            else
                models.push(model);
        }
        this._models = models;
        return Promise.resolve(name);
    }

    getModel(name) {
        var model;
        if (this._models) {
            var arr = this._models.filter(function (x) { return x.getName() === name });
            if (arr && arr.length == 1)
                model = arr[0];
        }
        return model;
    }

    getModels() {
        return this._models;
    }
}

module.exports = Shelf;