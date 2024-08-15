const path = require('path');
const fs = require('fs');
const _eval = require('eval');

const inflection = require('inflection');

const QueryParser = require(path.join(__dirname, './queryparser'));
const Logger = require(path.join(__dirname, '../common/logger/logger'));
const base64 = require(path.join(__dirname, '../common/base64'));

global.DEFAULT_TIMESTAMP_PRECISION = 3;

class UnknownModelError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnknownModelError";
    }
}

class Model {

    /**
     * @param {*} knex 
     * @param {*} tableName 
     * @param {*} columnName 
     * @returns 
     */
    static dropColumn = (knex, tableName, columnName) => {
        return knex.schema.hasColumn(tableName, columnName).then((hasColumn) => {
            if (hasColumn) {
                return knex.schema.alterTable(tableName, table => {
                    table.dropColumn(columnName);
                });
            } else
                return null;
        });
    }

    static renameColumn = (knex, tableName, from, to) => {
        return knex.schema.hasColumn(tableName, from).then((hasColumn) => {
            if (hasColumn) {
                return knex.schema.alterTable(tableName, table => {
                    table.renameColumn(from, to);
                });
            } else
                return null;
        });
    }

    _shelf;
    _id;
    _definition;

    _name;
    _tableName;

    _relationNames;
    _book;

    _module;
    _preCreateHook;
    _postCreateHook;
    _preUpdateHook;
    _postUpdateHook;
    _preDeleteHook;
    _postDeleteHook;
    _postReadHook;

    _bInitDone;

    constructor(shelf, id, definition) {
        this._shelf = shelf;
        this._id = id;
        this._definition = definition;

        this._name = this._definition.name;
        if (this._definition.tableName)
            this._tableName = this._definition.tableName;
        else
            this._tableName = this._definition.name;
    }

    async initModel(bForce) {
        if (!this._bInitDone || bForce) {
            Logger.info("Init model '" + this._name + "'");
            this._relationNames = [];
            if (this._definition['_sys'] && this._definition['_sys']['modules']) {
                const module = this._definition['_sys']['modules']['server'];
                if (module) {
                    this._module = _eval(module, true);
                    if (this._module.init)
                        await this._module.init.bind(this)();
                    if (this._module.preCreateHook)
                        this.setPreCreateHook(this._module.preCreateHook);
                    if (this._module.postCreateHook)
                        this.setPostCreateHook(this._module.postCreateHook);
                    if (this._module.preUpdateHook)
                        this.setPreUpdateHook(this._module.preUpdateHook);
                    if (this._module.postUpdateHook)
                        this.setPostUpdateHook(this._module.postUpdateHook);
                    if (this._module.preDeleteHook)
                        this.setPreDeleteHook(this._module.preDeleteHook);
                    if (this._module.postDeleteHook)
                        this.setPostDeleteHook(this._module.postDeleteHook);
                    if (this._module.postReadHook)
                        this.setPostReadHook(this._module.postReadHook);
                }
            }
            await this.initTables();
            this.createBook();
            this._bInitDone = true;
        }
        return Promise.resolve();
    }

    async initCustomDataTypes() {
        var dt;
        const dtc = controller.getDataTypeController();
        for (var attribute of this._definition['attributes']) {
            switch (attribute['dataType']) {
                case 'boolean':
                case 'integer':
                case 'decimal':
                case 'double':
                case 'string':
                case 'text':
                case 'url':
                case 'json':
                case 'date':
                case 'time':
                case 'datetime':
                case 'timestamp':
                case 'enumeration':
                case 'list':
                case 'relation':
                case 'file':
                    break;
                default:
                    dt = dtc.getDataType(attribute['dataType']);
                    if (dt) {
                        if (typeof dt.init === 'function')
                            await dt.init(this, attribute);
                    } else
                        console.log(attribute['dataType']);
            }
        }
        return Promise.resolve();
    }

    async initTables(bJunctions = true) {
        const knex = this._shelf.getKnex();
        const exist = await knex.schema.hasTable(this._tableName);
        if (!exist) {
            await knex.schema.createTable(this._tableName, async function (table) {
                //table.engine('innodb');
                if (this._definition.options) {
                    if (this._definition.options.increments)
                        table.increments('id');
                    if (this._definition.options.timestamps) {
                        // https://knexjs.org/guide/schema-builder.html#timestamps
                        if (controller.getDatabaseSettings()['client'].startsWith('mysql')) {
                            //table.specificType('created_at', 'TIMESTAMP(3)').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)')); // 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
                            table.timestamp('created_at', { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(knex.fn.now(DEFAULT_TIMESTAMP_PRECISION));
                            table.timestamp('updated_at', { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(knex.fn.now(DEFAULT_TIMESTAMP_PRECISION));
                        } else
                            table.timestamps(true, true);
                    }
                }
                switch (this._definition.charEncoding) {
                    case 'latin1':
                        table.charset('latin1');
                        //table.collate('latin1_bin');
                        break;
                    case 'utf8':
                        table.charset('utf8');
                        //table.collate('utf8_general_ci');
                        break;
                    case 'utf8mb4':
                        table.charset('utf8mb4');
                        //table.collate('utf8mb4_0900_ai_ci');
                        break;
                    default:
                }

                if (this._definition.attributes)
                    this._addColumns(table, null, this._definition.attributes);

                return Promise.resolve();
            }.bind(this));
            Logger.info("Created table '" + this._tableName + "'");
        } else {
            var tableInfo = await knex.table(this._tableName).columnInfo();
            /*if (this._definition.options.timestamps) {
                if (!tableInfo.hasOwnProperty('created_at') || !tableInfo.hasOwnProperty('updated_at')) {
                    await this._shelf.getKnex().schema.alterTable(this._tableName, async function (table) {
                        table.timestamps(true, true);
                    }.bind(this));
                }
            }*/
            if (this._definition.attributes) {
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    this._addColumns(table, tableInfo, this._definition.attributes);
                }.bind(this));
            }
        }

        if (bJunctions) {
            if (this._definition.attributes) {
                const junctions = this._definition.attributes.filter(function (attribute) {
                    if (attribute['baseDataType'])
                        attribute = attribute['baseDataType'];
                    return (attribute['dataType'] === "relation" && attribute['multiple'] && !attribute['via']);
                });
                for (var junction of junctions) {
                    try {
                        await this._addJunctionTable(junction);
                    } catch (error) {
                        if (error instanceof UnknownModelError)
                            Logger.warning("[model: '" + this._name + "', attribute: '" + junction['name'] + "'] " + error['message']);
                        else {
                            Logger.error("[model: '" + this._name + "', attribute: '" + junction['name'] + "'] Creating junktion table failed");
                            throw error;
                        }
                    }
                }
            }
        }
        return Promise.resolve();
    }

    _addColumns(table, tableInfo, attributes) {
        for (let attribute of attributes) {
            if (attribute['baseDataType'])
                attribute = attribute['baseDataType'];
            if (attribute['dataType'] === "relation") {
                if (this._relationNames)
                    this._relationNames.push(attribute['name']);
                if (!attribute.via) {
                    if (!attribute.multiple) {
                        if (!tableInfo || !tableInfo.hasOwnProperty(attribute['name']))
                            this._addColumn(table, attribute);
                    }
                }
            } else if (!attribute.hasOwnProperty("persistent") || attribute.persistent === true) {
                if (!tableInfo || !tableInfo.hasOwnProperty(attribute['name']))
                    this._addColumn(table, attribute);
                else {
                    switch (attribute['dataType']) {
                        case "string":
                            var maxLength = tableInfo[attribute['name']]['maxLength'];
                            if (attribute.length && attribute.length != maxLength)
                                table.string(attribute.name, attribute.length).alter();
                            break;
                        case "datetime":
                            var current = tableInfo[attribute['name']]['defaultValue'];
                            var defaultValue = attribute['defaultValue'];
                            var value;
                            if (defaultValue === 'CURRENT_TIMESTAMP')
                                value = this._shelf.getKnex().fn.now(DEFAULT_TIMESTAMP_PRECISION);
                            else
                                value = defaultValue;
                            if (defaultValue) {
                                if (!current)
                                    table.datetime(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(value).alter();
                                else {
                                    if (defaultValue === 'CURRENT_TIMESTAMP') {
                                        if (!current.startsWith('CURRENT_TIMESTAMP'))
                                            table.datetime(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(value).alter();
                                    } else if (current != defaultValue)
                                        table.datetime(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(value).alter();
                                }
                            } else if (current)
                                table.datetime(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(null).alter();
                            break;
                        case "timestamp":
                            var current = tableInfo[attribute['name']]['defaultValue'];
                            var defaultValue = attribute['defaultValue'];
                            var value;
                            if (defaultValue === 'CURRENT_TIMESTAMP')
                                value = this._shelf.getKnex().fn.now(DEFAULT_TIMESTAMP_PRECISION);
                            else
                                value = defaultValue;
                            if (defaultValue) {
                                if (!current)
                                    table.timestamp(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(value).alter();
                                else {
                                    if (defaultValue === 'CURRENT_TIMESTAMP') {
                                        if (!current.startsWith('CURRENT_TIMESTAMP'))
                                            table.timestamp(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(value).alter();
                                    } else if (current != defaultValue)
                                        table.timestamp(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(value).alter();
                                }
                            } else if (current)
                                table.timestamp(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION }).defaultTo(null).alter();
                            break;
                    }
                }
            }
        }
        return Promise.resolve();
    }

    _addColumn(table, attribute) {
        if (attribute['baseDataType'])
            attribute = attribute['baseDataType'];
        switch (attribute['dataType']) {
            case "boolean":
                var column = table.boolean(attribute.name);
                if (attribute.defaultValue != null && attribute.defaultValue != undefined) {
                    if (attribute.defaultValue)
                        column.defaultTo('1');
                    else
                        column.defaultTo('0');
                }
                column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "integer":
                var column;
                if (attribute.length)
                    column = table.integer(attribute.name, attribute.length);
                else
                    column = table.integer(attribute.name);
                if (attribute.primary)
                    column.primary();
                if (attribute.unsigned)
                    column.unsigned();
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "double":
                var column = table.double(attribute.name);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "decimal":
                var column = table.decimal(attribute.name);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "string":
                var column;
                if (attribute.length)
                    column = table.string(attribute.name, attribute.length);
                else
                    column = table.string(attribute.name);
                if (attribute.primary)
                    column.primary();
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                if (attribute.unique)
                    column.unique(); //could fail if there was no length specified
                break;
            case "url":
                var column;
                if (attribute.length)
                    column = table.string(attribute.name, attribute.length);
                else
                    column = table.string(attribute.name);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "enumeration":
                if (attribute.bUseString) {
                    var column = table.string(attribute.name);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                } else {
                    var column = table.enu(attribute.name, attribute.options.map(function (x) { return x['value'] }));
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                }
                break;
            case "list":
                var column = table.json(attribute.name);
                break;
            case "text":
                var column;
                if (attribute.length) {
                    if (attribute.length <= 65535)
                        column = table.text(attribute.name);
                    else if (attribute.length <= 16777215)
                        column = table.text(attribute.name, 'mediumtext');
                    else
                        column = table.text(attribute.name, 'longtext');
                } else
                    column = table.text(attribute.name);
                if (attribute.charEncoding) {
                    switch (attribute.charEncoding) {
                        case 'latin1':
                            column.collate('latin1_bin');
                            break;
                        case 'utf8':
                            column.collate('utf8_general_ci');
                            break;
                        case 'utf8mb4':
                            column.collate('utf8mb4_0900_ai_ci');
                            break;
                        default:
                    }
                }
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "json":
                var column = table.json(attribute.name);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "time":
                var column = table.time(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION });
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "date":
                var column = table.date(attribute.name);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "datetime":
                var column = table.datetime(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION });
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "timestamp":
                var column = table.timestamp(attribute.name, { precision: DEFAULT_TIMESTAMP_PRECISION });
                if (attribute.defaultValue) {
                    if (attribute.defaultValue === 'CURRENT_TIMESTAMP')
                        column.defaultTo(this._shelf.getKnex().fn.now(DEFAULT_TIMESTAMP_PRECISION)); // column.defaultTo(this._shelf.getKnex().raw('CURRENT_TIMESTAMP'));
                    else
                        column.defaultTo(attribute.defaultValue);
                }
                if (attribute.required)
                    column.notNullable();
                break;
            case "relation":
                var model = this._shelf.getModel(attribute['model']);
                if (model)
                    table.integer(attribute.name).unsigned().references('id').inTable(model.getTableName());
                else
                    table.integer(attribute.name);
                break;
            case "file":
                var column;
                if (attribute['storage']) {
                    if (attribute['storage'] == 'base64') {
                        column = table.text(attribute['name'], 'longtext');
                    } else if (attribute['storage'] == 'blob') {
                        if (attribute['length']) {
                            if (attribute['length'] <= 65535)
                                column = table.binary(attribute['name'], attribute['length']);
                            else if (attribute['length'] <= 16777215)
                                column = table.specificType(attribute['name'], "MEDIUMBLOB");
                            else
                                column = table.specificType(attribute['name'], "LONGBLOB");
                        } else {
                            column = table.binary(attribute['name']);
                        }
                    } else if (attribute['storage'] == 'filesystem') {
                        if (attribute['length'])
                            column = table.string(attribute['name'], attribute['length']);
                        else
                            column = table.string(attribute['name']);

                        /*if (attribute['defaultValue'])
                            column.defaultTo(attribute.defaultValue);*/
                        if (attribute['unique'])
                            column.unique();
                    }
                } else
                    throw new Error("[model: '" + this._name + "', attribute: '" + attribute.name + "'] missing storage information'");

                if (attribute['required'])
                    column.notNullable();

                //if (attribute['filename_prop']) 
                //if (attribute['url_prop'])
                break;
            default:
                const dtc = controller.getDataTypeController();
                const dt = dtc.getDataType(attribute['dataType']);
                if (dt) {
                    if (typeof dt.add === 'function')
                        dt.add(this, table, attribute);
                } else
                    throw new Error("[model: '" + this._name + "', attribute: '" + attribute.name + "'] unknown datatype '" + attribute['dataType'] + "'");
        }
        Logger.info("Added column '" + attribute.name + "' to table '" + this._tableName + "'");
    }

    getJunctionTableName(attribute) {
        var relTable = attribute.tableName;
        if (!relTable) {
            const model = this._shelf.getModel(attribute['model']);
            if (model) {
                if (attribute['model'] === this._name) {
                    relTable = this._tableName + "_" + attribute['name'];
                } else {
                    const modelTable = model.getTableName();
                    if (this._tableName.localeCompare(modelTable) == -1)
                        relTable = this._tableName + "_" + modelTable;
                    else
                        relTable = modelTable + "_" + this._tableName;
                }
            }
        }
        return relTable;
    }

    async _addJunctionTable(attribute) {
        const knex = this._shelf.getKnex();
        const model = this._shelf.getModel(attribute['model']);
        if (model) {
            const modelTable = model.getTableName();
            const relTable = this.getJunctionTableName(attribute);
            if (!await knex.schema.hasTable(relTable)) {
                const id = inflection.singularize(this._tableName) + "_id";
                var fid;
                if (attribute['model'] === this._name)
                    fid = inflection.singularize(attribute['name']) + "_id";
                else
                    fid = inflection.singularize(modelTable) + "_id";
                try {
                    await knex.schema.createTable(relTable, function (table) {
                        table.increments('id').primary();

                        table.integer(id).unsigned().notNullable().references('id').inTable(this._tableName);
                        table.integer(fid).unsigned().notNullable().references('id').inTable(modelTable);
                    }.bind(this));
                } catch (error) {
                    if (error['sqlMessage'] && error['code'] == 'ER_FK_CANNOT_OPEN_PARENT') {
                        console.error(error);
                        Logger.warning("[model: '" + this._name + "', attribute: '" + attribute['name'] + "'] ⚠ " + error['code'] + ": " + error['sqlMessage']);
                    } else
                        throw error;
                }
                Logger.info("Created table '" + relTable + "'");

                //TODO: migrate old data
                var table = knex.table(this._tableName);
                var tableInfo = await table.columnInfo();
                if (tableInfo.hasOwnProperty(attribute['name'])) {
                    var resultset = await knex.select('id as ' + id, attribute['name'] + " as " + fid).from(this._tableName).where(attribute['name'], 'is not', null);
                    //console.log(resultset);
                    await knex(relTable).insert(resultset);
                }
            }
        } else
            throw new UnknownModelError("Model '" + attribute['model'] + "' is not defined");
        return Promise.resolve();
    }

    async deleteAttribute(name) {
        const attr = this.getAttribute(name);
        if (attr['dataType'] !== 'relation')
            await Model.dropColumn(this._shelf.getKnex(), this.getTableName(), name);
        return Promise.resolve();
    }

    async renameAttribute(from, to) {
        const attr = this.getAttribute(from);
        if (attr['dataType'] !== 'relation')
            await Model.renameColumn(this._shelf.getKnex(), this.getTableName(), from, to);
        return Promise.resolve();
    }

    getAttribute(name) {
        return this._definition.attributes.filter(function (x) { return x.name === name })[0];
    }

    createBook() {
        const obj = {};
        const shelf = this._shelf;

        if (this._definition.attributes) {
            for (let attribute of this._definition.attributes) {
                if (attribute['dataType'] === "relation" || this._relationNames.indexOf(attribute.name) !== -1) {
                    if (attribute.via) {
                        obj[attribute.name] = function () {
                            var book;
                            var model = shelf.getModel(attribute['model']);
                            if (model && model.initDone())
                                book = model.getBook();
                            else
                                throw new Error('Faulty model \'' + attribute['model'] + '\'');
                            return this.hasMany(book, attribute.via);
                        };
                    } else {
                        if (attribute.multiple) {
                            if (attribute.model === this._name) {
                                var tableName = this.getJunctionTableName(attribute);
                                var id = inflection.singularize(this._tableName) + "_id";
                                var fid = inflection.singularize(attribute['name']) + "_id";
                                obj[attribute.name] = function () {
                                    var book;
                                    var model = shelf.getModel(attribute['model']);
                                    if (model && model.initDone())
                                        book = model.getBook();
                                    else
                                        throw new Error('Faulty model \'' + attribute['model'] + '\'');
                                    return this.belongsToMany(book, tableName, id, fid);
                                };
                            } else {
                                obj[attribute.name] = function () {
                                    var book;
                                    var model = shelf.getModel(attribute['model']);
                                    if (model && model.initDone())
                                        book = model.getBook();
                                    else
                                        throw new Error('Faulty model \'' + attribute['model'] + '\'');
                                    return this.belongsToMany(book);
                                };
                            }
                        } else {
                            obj[attribute.name] = function () {
                                var book;
                                var model = shelf.getModel(attribute['model']);
                                if (model && model.initDone())
                                    book = model.getBook();
                                else
                                    throw new Error('Faulty model \'' + attribute['model'] + '\'');
                                return this.belongsTo(book, attribute.name);
                            };
                        }
                    }
                }
            }
        }

        if (this._definition.tableName)
            obj['tableName'] = this._definition.tableName;
        else
            obj['tableName'] = this._definition.name;
        if (this._definition.options && this._definition.options.timestamps)
            obj['hasTimestamps'] = true;
        //this._book = this._shelf.getBookshelf().model(this._name, obj);
        this._book = this._shelf.getBookshelf().Model.extend(obj);
    }

    setPreCreateHook(func) {
        this._preCreateHook = func.bind(this);
    }

    setPostCreateHook(func) {
        this._postCreateHook = func.bind(this);
    }

    setPreUpdateHook(func) {
        this._preUpdateHook = func.bind(this);
    }

    setPostUpdateHook(func) {
        this._postUpdateHook = func.bind(this);
    }

    setPreDeleteHook(func) {
        this._preDeleteHook = func.bind(this);
    }

    setPostDeleteHook(func) {
        this._postDeleteHook = func.bind(this);
    }

    setPostReadHook(func) {
        this._postReadHook = func.bind(this);
    }

    initDone() {
        return this._bInitDone;
    }

    getId() {
        return this._id;
    }

    setId(id) {
        this._id = id;
    }

    getDefinition() {
        return this._definition;
    }

    setDefinition(definition) {
        this._definition = definition;
    }

    getName() {
        return this._name;
    }

    getTableName() {
        return this._tableName;
    }

    getRelations() {
        return this._relationNames;
    }

    getShelf() {
        return this._shelf;
    }

    getBook() {
        return this._book;
    }

    async read(id, query) {
        var res;
        if (this._bInitDone && this._book) {
            var field;
            if (query) {
                if (query.hasOwnProperty('$field')) {
                    if (Array.isArray(query['$field']))
                        field = query['$field'];
                    else
                        field = query['$field'].split(',');
                    delete query['$field'];
                }
            }
            const options = {
                'require': true
            };
            if (field) {
                options['columns'] = [];
                options['withRelated'] = [];
                for (var name of field) {
                    if (this._relationNames.includes(name))
                        options['withRelated'].push(name);
                    else
                        options['columns'].push(name);
                }
            } else
                options['withRelated'] = this._relationNames
            var obj = await this._book.where({ 'id': id }).fetch(options);
            if (field && field.length == 1) {
                if (options['withRelated'].includes(field[0]))
                    res = obj['relations'][field[0]].map(x => { return x['id'] });
                else
                    res = obj['attributes'][field[0]];
            } else
                res = obj.toJSON();


            if (this._postReadHook)
                res = await this._postReadHook(res);
        } else
            throw new Error('Faulty model \'' + this._name + '\'');
        return Promise.resolve(res);
    }

    async readAll(query, bHook = true) {
        var res;
        if (this._bInitDone && this._book) {
            var book;
            var field;
            if (query) {
                if (query.hasOwnProperty('$field')) {
                    if (Array.isArray(query['$field']))
                        field = query['$field'];
                    else
                        field = query['$field'].split(',');
                    delete query['$field'];
                }
                book = await this.where(query);
            } else
                book = this._book;
            var options;
            if (field) {
                options = {
                    'columns': [],
                    'withRelated': []
                };
                for (var name of field) {
                    if (this._relationNames.includes(name))
                        options['withRelated'].push(name);
                    else
                        options['columns'].push(name);
                }
            } else {
                options = {
                    'withRelated': this._relationNames
                };
            }
            const rs = await book.fetchAll(options);
            const arr = rs.toJSON();
            if (this._postReadHook && bHook) {
                res = [];
                for (var data of arr) {
                    res.push(await this._postReadHook(data));
                }
            } else
                res = arr;
        } else
            throw new Error('Faulty model \'' + this._name + '\'');
        return Promise.resolve(res);
    }

    async count(query) {
        var res;
        if (this._bInitDone && this._book) {
            var book;
            var field;
            if (query) {
                if (query.hasOwnProperty('$field')) {
                    if (Array.isArray(query['$field']))
                        field = query['$field'];
                    else
                        field = query['$field'].split(',');
                    delete query['$field'];
                }
                book = await this.where(query);
            } else
                book = this._book;

            if (this._definition.options.increments)
                res = await book.count(this.getTableName() + '.id');
        } else
            throw new Error('Faulty model \'' + this._name + '\'');
        return Promise.resolve(res);
    }

    async where(query) {
        var qp = new QueryParser(this);
        return qp.executeQuery(query);
    }

    /**
     * 
     * @param {*} data 
     * @returns object
     */
    async create(data) {
        var res;

        if (this._preCreateHook)
            data = await this._preCreateHook(data);

        res = await this._create(data);
        return Promise.resolve(res);
    }

    _create(data) {
        return this._shelf.getBookshelf().transaction(async (transaction) => {
            return new Promise(async (resolve, reject) => {
                try {
                    var res;
                    if (this._definition.options.increments) {
                        var forge = await this._createForge(data);
                        this._book.forge(forge).save(null, { transacting: transaction, method: 'insert' }).then(async function (obj) {
                            var res;
                            var id = obj['id'];
                            var attr;
                            for (var str of this._relationNames) {
                                if (data.hasOwnProperty(str)) {
                                    attr = this._definition.attributes.filter(function (x) { return x['name'] === str })[0];
                                    if (attr['multiple']) {
                                        if (Array.isArray(data[str])) {
                                            var coll = obj[str]();
                                            if (coll.relatedData.type === 'hasMany') { //relation via
                                                var attr = this._definition.attributes.filter(function (x) { return x.name === str })[0];
                                                if (attr)
                                                    await this._updateHasManyRelation(transaction, attr, data[str], id);
                                            } else {
                                                await coll.attach(data[str], { transacting: transaction });
                                            }
                                        } else
                                            reject(new Error("Invalid value for property '" + str + "'")); // transaction.rollback();
                                    }
                                }
                            }
                            obj = await obj.load(this._relationNames, { transacting: transaction });
                            res = obj.toJSON();
                            resolve(res); // transaction.commit();
                        }.bind(this))
                            .catch(error => {
                                reject(error);
                            });
                    } else {
                        res = await this.upsert(data);
                        resolve(res); // transaction.commit();
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    async update(id, data, transaction) {
        var res;

        var current;
        var obj;
        if (this._definition.options.increments) {
            obj = await this._book.where({ 'id': id }).fetch({
                'withRelated': this._relationNames,
                'require': true
            });
        } else {
            var key = {};
            var name;
            for (var attribute of this._definition.attributes) {
                if (attribute['primary']) {
                    name = attribute['name'];
                    key[name] = data[name];
                }
            }
            obj = await this._book.where(key).fetch({
                'withRelated': this._relationNames,
                'require': false
            });
        }
        if (obj)
            current = obj.toJSON();
        if (this._preUpdateHook)
            data = await this._preUpdateHook(current, data);

        if (transaction)
            res = await this._update(transaction, id, current, data);
        else {
            res = await this._shelf.getBookshelf().transaction(async (transaction) => {
                return this._update(transaction, id, current, data);
            });
        }
        return Promise.resolve(res);
    }

    _update(transaction, id, current, data) {
        return new Promise(async (resolve, reject) => {
            try {
                var res;
                if (this._definition.options.increments) {
                    var forge = await this._createForge(data, current);

                    if (id) {
                        if (!forge['id'])
                            forge['id'] = id;
                        else if (forge['id'] !== id)
                            throw new Error("Conflict in received IDs");
                    } else
                        id = forge['id'];

                    if (!id)
                        throw new Error("ID missing");

                    this._book.forge(forge).save(null, { transacting: transaction }).then(async function (obj) {
                        var res;
                        var attr;
                        for (var str of this._relationNames) {
                            if (data.hasOwnProperty(str)) {
                                attr = this._definition.attributes.filter(function (x) { return x['name'] === str })[0];
                                if (attr['multiple']) {
                                    if (!data[str])
                                        data[str] = [];
                                    if (Array.isArray(data[str])) {
                                        if (attr['via']) // coll.relatedData.type === 'hasMany'
                                            await this._updateHasManyRelation(transaction, attr, data[str], id);
                                        else {
                                            var coll = obj[str]();
                                            await coll.detach(null, { transacting: transaction });
                                            await coll.attach(data[str], { transacting: transaction });
                                        }
                                    } else
                                        reject(new Error("Invalid value for property '" + str + "'")); // transaction.rollback();
                                }
                            }
                        }
                        obj = await obj.load(this._relationNames, { transacting: transaction });
                        res = obj.toJSON();
                        resolve(res); // transaction.commit();
                    }.bind(this))
                        .catch(error => {
                            reject(error);
                        });
                } else {
                    res = await this.upsert(data);
                    resolve(res); // transaction.commit();
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    async upsert(data) {
        var res;
        await this._shelf.getKnex()(this._tableName).insert(data).onConflict().merge();
        var obj = await this._book.where(data).fetch({
            'withRelated': this._relationNames,
            'require': true
        });
        res = obj.toJSON();
        return Promise.resolve(res);
    }

    async _createForge(data, old) {
        const forge = {};
        const dtc = controller.getDataTypeController();
        var dt;
        var tmp;
        var attr;
        for (var str in data) {
            attr = this._definition.attributes.filter(function (x) { return x['name'] === str })[0];
            if (attr) {
                if (attr['baseDataType'])
                    attr = attr['baseDataType'];
                if (attr['dataType'] !== 'relation' || !attr['multiple']) {
                    if (!attr.hasOwnProperty('persistent') || attr.persistent == true) {
                        if (attr['dataType'] === 'json' || attr['dataType'] === 'list') {
                            var value = data[str];
                            if (value) {
                                if (typeof value === 'string' || value instanceof String)
                                    forge[str] = value;
                                else if (typeof value === 'object')
                                    forge[str] = JSON.stringify(value);
                            }
                        } else if (attr['dataType'] === 'timestamp' || attr['dataType'] === 'datetime') {
                            var value = data[str];
                            if (value && (typeof value === 'string' || value instanceof String) && value.endsWith('Z'))
                                forge[str] = value.substring(0, value.length - 1) + '+00:00';
                            else
                                forge[str] = value;
                        } else if (attr['dataType'] === 'file') {
                            if (data[str]) {
                                if (attr['storage'] == 'base64') {
                                    if (data[str]['base64'] && data[str]['base64'].startsWith("data:"))
                                        forge[str] = data[str]['base64'];
                                    else if (data[str]['url'] && data[str]['url'].startsWith("http"))
                                        forge[str] = await controller.getWebClientController().getWebClient().getBase64(data[str]['url']);
                                } else if (attr['storage'] == 'blob') {
                                    if (data[str]['blob'])
                                        forge[str] = data[str]['blob'];
                                    else if (data[str]['url'] && data[str]['url'].startsWith("http"))
                                        throw new Error('NotImplementedException'); //TODO:
                                } else if (attr['storage'] == 'filesystem') {
                                    var localPath = controller.getPathForFile(attr);
                                    if (localPath) {
                                        var tmpDir = await controller.getTmpDir();
                                        var tmpFilePath;
                                        var fileName;
                                        if (data[str]['filename'])
                                            fileName = data[str]['filename'];
                                        if (data[str]['base64']) {
                                            if (data[str]['base64'].startsWith("data:")) {
                                                if (fileName) {
                                                    tmpFilePath = path.join(tmpDir, path.basename(fileName));
                                                    if (fs.existsSync(tmpFilePath))
                                                        throw new Error("File '" + tmpFilePath + "' already exists!");
                                                } else
                                                    throw new Error("Missing file name!");
                                                base64.createFile(tmpFilePath, data[str]['base64']);
                                            } else
                                                throw new Error("Invalid base64 data!");
                                        } else if (data[str]['url']) {
                                            if (data[str]['url'].startsWith("http")) {
                                                if (data[str]['force'] || !attr['url_prop'] || !old || !old[attr['url_prop']] || old[attr['url_prop']] != data[str]['url']) {
                                                    if (fileName)
                                                        tmpFilePath = path.join(tmpDir, path.basename(fileName));
                                                    else
                                                        throw new Error("Missing file name!");
                                                    tmp = await controller.getWebClientController().getWebClient().download(data[str]['url'], tmpFilePath);
                                                    tmpFilePath = path.join(tmpDir, tmp);
                                                }
                                            } else
                                                throw new Error("Invalid URL!");
                                        }

                                        if (tmpFilePath) {
                                            if (old && old[str]) {
                                                var oldFile = path.join(localPath, old[str]);
                                                if (fs.existsSync(oldFile))
                                                    fs.unlinkSync(oldFile);
                                            }
                                            const target = path.join(localPath, fileName);
                                            const dir = path.dirname(target);
                                            if (dir && !(fs.existsSync(dir) && fs.statSync(dir).isDirectory()))
                                                fs.mkdirSync(dir, { recursive: true });
                                            // fs.rename fails if two separate partitions are involved
                                            if (data[str]['force'])
                                                fs.copyFileSync(tmpFilePath, target);
                                            else if (!fs.existsSync(target))
                                                fs.copyFileSync(tmpFilePath, target, fs.constants.COPYFILE_EXCL);
                                            else {
                                                fs.unlinkSync(tmpFilePath);
                                                throw new Error("File '" + target + "' already exists");
                                            }
                                            fs.unlinkSync(tmpFilePath);
                                        } else {
                                            if (fileName) {
                                                if (old && old[str] && old[str] != fileName) {
                                                    var oldFile = path.join(localPath, old[str]);
                                                    var newFile = path.join(localPath, fileName);
                                                    if (fs.existsSync(oldFile) && !fs.existsSync(newFile))
                                                        fs.renameSync(oldFile, newFile);
                                                }
                                            } else {
                                                if (old && old[str] && data[str]['delete']) {
                                                    var file = path.join(localPath, old[str]);
                                                    if (fs.existsSync(file))
                                                        fs.unlinkSync(file);
                                                }
                                            }
                                        }

                                        if (fileName)
                                            forge[str] = fileName;
                                        else
                                            forge[str] = null;
                                    } else
                                        throw new Error("Invalid file storage path!");
                                }

                                if ((attr['storage'] === 'base64' || attr['storage'] === 'blob') && data[str]['delete'])
                                    forge[str] = null;
                                if (attr['filename_prop'] && data[str]['filename'])
                                    forge[attr['filename_prop']] = data[str]['filename'];
                                if (attr['url_prop']) {
                                    if (data[str]['url']) {
                                        if (!old || !old[attr['url_prop']] || old[attr['url_prop']] != data[str]['url'])
                                            forge[attr['url_prop']] = data[str]['url'];
                                    } else {
                                        if (old && old[attr['url_prop']])
                                            forge[attr['url_prop']] = null;
                                    }
                                }
                            } else {
                                forge[str] = null;
                                if (attr['filename_prop'])
                                    forge[attr['filename_prop']] = null;
                                if (attr['url_prop']) {
                                    forge[attr['url_prop']] = null;
                                }
                            }
                        } else {
                            dt = dtc.getDataType(attr['dataType']);
                            if (dt && dt.createForge)
                                await dt.createForge(attr, data, old, forge);
                            else
                                forge[str] = data[str];
                        }
                    }
                }
            } else if (str === 'id' && this._definition.options.increments) {
                forge[str] = data[str];
            } else
                throw new Error("Undefined Attribute '" + str + "'");
        }
        return Promise.resolve(forge);
    }

    async _updateHasManyRelation(transaction, attr, ids, id) {
        var model = this._shelf.getModel(attr['model']);
        var via = attr['via'];
        var o = {};
        o[via] = id;
        for (var i of ids) {
            await model.update(i, o, transaction);
        }
        return Promise.resolve();
    }

    async delete(id) {
        var res;
        var obj;
        if (this._definition.options.increments) {
            obj = await this._book.forge({ 'id': id }).fetch({
                'withRelated': this._relationNames
            });
        } else {
            obj = await this._book.where(id).fetch({
                'withRelated': this._relationNames,
                'require': true
            });
        }

        res = obj.toJSON();

        if (this._preDeleteHook)
            await this._preDeleteHook(res);

        for (var attribute of this._definition.attributes) {
            if (attribute['baseDataType'])
                attribute = attribute['baseDataType'];
            if (attribute['dataType'] === "relation") {
                if (attribute['via']) {
                    var related = obj.related(attribute['name']);
                    //console.log(related.pluck('id'));
                    for (var x of related) {
                        await x.set(attribute['via'], null).save();
                    }
                } else {
                    if (attribute['multiple']) {
                        if (attribute['model'] === this._name) {
                            var tableName = this.getJunctionTableName(attribute);
                            var fid = inflection.singularize(this.getTableName()) + "_id";
                            await this._shelf.getKnex()(tableName).where(fid, id).del();
                        } else
                            await obj[attribute['name']]().detach();
                    } else {
                        if (attribute['model'] === this._name)
                            await this._shelf.getKnex()(this._tableName).update(attribute['name'], null).where(attribute['name'], id);
                    }
                }
            }
        }
        const models = this._shelf.getModel();
        if (models) {
            var def;
            for (var model of models) {
                if (model.getName() != this._name) {
                    def = model.getDefinition();
                    for (var attr of def['attributes']) {
                        if (attr['baseDataType'])
                            attr = attr['baseDataType'];
                        if (attr['dataType'] === 'relation' && attr['model'] === this._name && !attr['via']) {
                            if (attr['multiple']) {
                                var tableName = model.getJunctionTableName(attr);
                                var fid = inflection.singularize(this.getTableName()) + "_id";
                                await this._shelf.getKnex()(tableName).where(fid, id).del();
                            } else
                                await this._shelf.getKnex()(model.getTableName()).update(attr['name'], null).where(attr['name'], id);
                        }
                    }
                }
            }
        }
        if (this._definition.options.increments)
            await obj.destroy();
        else
            await this._shelf.getKnex()(this._tableName).where(id).del();

        var value;
        var localPath;
        var file;
        var dt;
        const dtc = controller.getDataTypeController();
        for (var attribute of this._definition['attributes']) {
            value = res[attribute['name']];
            if (value) {
                switch (attribute['dataType']) {
                    case 'file':
                        if (attribute['storage'] == 'filesystem') {
                            localPath = controller.getPathForFile(attribute);
                            if (localPath) {
                                file = path.join(localPath, value);
                                if (fs.existsSync(file))
                                    fs.unlinkSync(file);
                            }
                        }
                        break;
                    case 'boolean':
                    case 'integer':
                    case 'decimal':
                    case 'double':
                    case 'string':
                    case 'text':
                    case 'url':
                    case 'json':
                    case 'date':
                    case 'time':
                    case 'datetime':
                    case 'timestamp':
                    case 'enumeration':
                    case 'list':
                    case 'relation':
                        break;
                    default:
                        dt = dtc.getDataType(attribute['dataType']);
                        if (dt && dt.destroy)
                            await dt.destroy(attribute, res, value);
                }
            }
        }

        if (this._postDeleteHook)
            await this._postDeleteHook(res);

        return Promise.resolve(res);
    }
}

module.exports = Model;