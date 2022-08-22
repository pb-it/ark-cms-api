class Registry {

    _knex;

    _model;

    constructor(knex) {
        this._knex = knex;
    }

    async initRegistry() {
        var shelf = controller.getShelf();
        this._model = shelf.getModel('_registry');
        if (!this._model) {
            var definition = {
                "name": "_registry",
                "options": {
                    "increments": false,
                    "timestamps": false
                },
                "attributes": [
                    {
                        "name": "key",
                        "dataType": "string",
                        "primary": true,
                        "length": 63,
                        "required": true,
                        "unique": true
                    },
                    {
                        "name": "value",
                        "dataType": "text"
                    }
                ]
            }
            this._model = await shelf.upsertModel(null, definition);
        } else
            await this._model.initModel();

        /*var exist = await this._knex.schema.hasTable('_registry');
        if (!exist) {
            await this._knex.schema.createTable('_registry', function (table) {
                table.increments('id').primary();
                table.string('key', 63).unique().notNullable();
                table.text('value');
            });
            Logger.info("Created '_registry' table");
        }*/
        return Promise.resolve();
    }

    async get(key) {
        var value;
        var data = await this._model.readAll({ 'key': key });
        if (data && data.length == 1)
            value = data[0]['value'];
        return Promise.resolve(value);
    }

    async upsert(key, value) {
        return this._model.upsert({ 'key': key, 'value': value });
    }
}

module.exports = Registry;