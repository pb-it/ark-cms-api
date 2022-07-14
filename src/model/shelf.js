const Logger = require('../logger');
const Model = require('./model');

class Shelf {

    _knex;
    _bookshelf;

    _models;

    constructor(knex) {
        this._knex = knex;
        this._bookshelf = require('bookshelf')(this._knex);
    }

    async init() {
        var exist = await this._knex.schema.hasTable('_model');
        if (!exist) {
            await this._knex.schema.createTable('_model', function (table) {
                table.increments('id').primary();
                table.string('name', 63).unique().notNullable();
                table.json('definition');
            });
            Logger.info("Created '_model' table");
        }
        return Promise.resolve();
    }

    getKnex() {
        return this._knex;
    }

    getBookshelf() {
        return this._bookshelf;
    }

    async loadModels() {
        this._models = [];

        var dataset = await this._knex('_model').select('id', 'definition');
        var def;
        var data;
        var model;
        for (const row of dataset) {
            def = row['definition'];
            if (typeof def === 'object') //mysql2
                data = def;
            else if (typeof def === 'string' || def instanceof String) //mysql
                data = JSON.parse(def);
            data['id'] = row['id'];
            model = new Model(this, data);
            this._models.push(model);
        };
        return Promise.resolve();
    }

    async initModels() {
        for (var m of this._models) {
            try {
                await m.init(false);
            } catch (error) {
                Logger.parseError(error);
            }
        }
        return Promise.resolve();
    }

    async upsertModel(definition) {
        var name = definition.name;

        var data;
        var res = await this._knex('_model').where('name', name).count('*');
        var count = res[0]['count(*)'];
        if (count == 0)
            data = await this._knex('_model').insert({ 'name': name, 'definition': JSON.stringify(definition) });
        else
            data = await this._knex('_model').where('name', name).update({ 'definition': JSON.stringify(definition) });

        res = await this._knex('_model').select('id').where('name', name);
        var id = res[0]['id'];

        definition['id'] = id;
        var model = new Model(this, definition);
        await model.init(true);
        var models = this._models.filter(function (x) { return x.getName() !== name });
        models.push(model);
        this._models = models;

        return Promise.resolve(id);
    }

    async deleteModel(id) {
        await this._knex('_model').where('id', id).delete();
        this._models = this._models.filter(function (x) { return x.getData()['id'] !== id });
        return Promise.resolve();
    }

    getModel(name) {
        var model;
        var arr = this._models.filter(function (x) { return x.getName() === name });
        if (arr && arr.length == 1)
            model = arr[0];
        return model;
    }

    getModels() {
        return this._models;
    }
}

module.exports = Shelf;