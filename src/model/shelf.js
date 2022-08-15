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
        };
        return Promise.resolve();
    }

    async initAllModels() {
        for (var m of this._models) {
            try {
                await m.initModel(false);
            } catch (error) {
                Logger.parseError(error);
            }
        }
        return Promise.resolve();
    }

    async upsertModel(id, definition) {
        var name = definition['name'];

        var data;
        var res;
        if (id) {
            var bCheckName = false;
            res = await this._knex('_model').where('id', id);
            if (res.length == 1) {
                if (res[0]['name'] === name)
                    data = await this._knex('_model').where('id', id).update({ 'definition': JSON.stringify(definition) });
                else {
                    var res = await this._knex('_model').where('name', name).count('*');
                    var count = res[0]['count(*)'];
                    if (count == 0)
                        data = await this._knex('_model').where('id', id).update({ 'name': name, 'definition': JSON.stringify(definition) });
                    else
                        throw new Error("Cannot update model name to '" + name + "' because it already exists an model with that name");
                }
                bCheckName = true;
            } else {
                var res = await this._knex('_model').where('name', name).count('*');
                var count = res[0]['count(*)'];
                if (count == 0)
                    data = await this._knex('_model').insert({ 'id': id, 'name': name, 'definition': JSON.stringify(definition) });
                else
                    throw new Error("An model with name '" + name + "' already exists with an different ID");
            }
        } else if (name) {
            var res = await this._knex('_model').where('name', name).count('*');
            var count = res[0]['count(*)'];
            if (count == 0)
                data = await this._knex('_model').insert({ 'name': name, 'definition': JSON.stringify(definition) });
            else
                data = await this._knex('_model').where('name', name).update({ 'definition': JSON.stringify(definition) });

            res = await this._knex('_model').select('id').where('name', name);
            id = res[0]['id'];
        }

        var model = new Model(this, id, definition);
        await model.initModel(true);
        var models = this._models.filter(function (x) { return x.getName() !== name });
        models.push(model);
        this._models = models;

        return Promise.resolve(id);
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