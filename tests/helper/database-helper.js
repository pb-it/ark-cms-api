class DatabaseHelper {

    _shelf;
    _knex;

    constructor(shelf) {
        this._shelf = shelf;
        this._knex = this._shelf.getKnex();
    }

    async deleteModel(model) {
        var id = model['id'];
        var name = model['definition']['name'];
        if (!name.startsWith('_')) {
            if (id)
                await this._shelf.deleteModel(id);
            if (name)
                await this._knex.schema.dropTable(name);
            var junctions = model['definition']['attributes'].filter(function (attribute) {
                return ((attribute['dataType'] === "relation") && !attribute.via && attribute.multiple);
            });
            for (var j of junctions) {
                await this._deleteJunctionTable(model['definition'], j);
            }
        }
        return Promise.resolve();
    }

    async _deleteJunctionTable(definition, attribute) {
        var model = this._shelf.getModel(attribute['model']);
        if (model) {
            var tableName;
            if (definition.tableName)
                tableName = definition.tableName;
            else
                tableName = definition.name;
            var modelTable = model.getTableName();
            var relTable;
            if (tableName.localeCompare(modelTable) == -1)
                relTable = tableName + "_" + modelTable;
            else
                relTable = modelTable + "_" + tableName;
            if (await this._knex.schema.hasTable(relTable))
                await this._knex.schema.dropTable(relTable);
        }
        return Promise.resolve();
    }
}

module.exports = DatabaseHelper;