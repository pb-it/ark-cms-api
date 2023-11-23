class DatabaseHelper {

    _shelf;
    _knex;

    constructor(shelf) {
        this._shelf = shelf;
        this._knex = this._shelf.getKnex();
    }

    async deleteModel(model) {
        const id = model['id'];
        const name = model['definition']['name'];
        if (!name.startsWith('_')) {
            const table = model['definition']['tableName'] ? model['definition']['tableName'] : name;
            try {
                await this._knex.raw('SET FOREIGN_KEY_CHECKS=0;');
                if (id)
                    await this._shelf.deleteModel(id);
                if (table)
                    await this._knex.schema.dropTable(table);
                var junctions = model['definition']['attributes'].filter(function (attribute) {
                    return ((attribute['dataType'] === "relation") && !attribute.via && attribute.multiple);
                });
                for (var j of junctions) {
                    await this._deleteJunctionTable(model['definition'], j);
                }
            } catch (error) {
                console.log(error);
            } finally {
                await this._knex.raw('SET FOREIGN_KEY_CHECKS=1;');
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