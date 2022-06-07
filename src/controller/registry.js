const Logger = require('../logger');

class Registry {

    _knex;

    constructor(knex) {
        this._knex = knex;
    }

    async init() {
        var exist = await this._knex.schema.hasTable('_registry');
        if (!exist) {
            await this._knex.schema.createTable('_registry', function (table) {
                table.increments('id').primary();
                table.string('key', 63).unique().notNullable();
                table.text('value');
            });
            Logger.info("Created '_registry' table");
        }
        return Promise.resolve();
    }

    async get(key) {
        var value;
        var dataset = await this._knex('_registry').select('value').where('key', key);
        if (dataset.length == 1) {
            value = dataset[0]['value'];
        }
        return Promise.resolve(value);
    }

    async upsert(key, value) {
        return await this._knex('_registry').insert({ 'key': key, 'value': value }).onConflict('key').merge();
    }
}

module.exports = Registry;