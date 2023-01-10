const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const _eval = require('eval');

const inflection = require('inflection');

const Logger = require(path.join(__dirname, '../common/logger/logger'));
const common = require(path.join(__dirname, '../common/common'));
const base64 = require(path.join(__dirname, '../common/base64'));
const webclient = require(path.join(__dirname, '../common/webclient'));

class UnknownModelError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnknownModelError";
    }
}

class Model {

    _shelf;
    _id;
    _definition;

    _name;
    _tableName;

    _relationNames;
    _book;

    _extension;

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

    async initModel() {
        Logger.info("Init model '" + this._name + "'");

        this._relationNames = [];

        if (this._definition['extensions']) {
            var extension = this._definition['extensions']['server'];
            if (extension) {
                this._extension = _eval(extension, true);
                if (this._extension.init)
                    await this._extension.init();
            }
        }

        var knex = this._shelf.getKnex();
        var exist = await knex.schema.hasTable(this._tableName);
        if (!exist) {
            await knex.schema.createTable(this._tableName, async function (table) {
                //table.engine('innodb');
                if (this._definition.options) {
                    if (this._definition.options.increments)
                        table.increments('id');
                    if (this._definition.options.timestamps) {
                        table.timestamps(true, true);
                        //table.dateTime('created_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
                        //table.dateTime('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
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
                    await this._addColumns(table, null, this._definition.attributes);
            }.bind(this));
            Logger.info("Added table '" + this._tableName + "'");
        } else {
            var tableInfo = await knex.table(this._tableName).columnInfo();
            if (this._definition.options.timestamps) {
                if (!tableInfo.hasOwnProperty('created_at') || !tableInfo.hasOwnProperty('updated_at')) {
                    await this._shelf.getKnex().schema.alterTable(this._tableName, async function (table) {
                        table.timestamps(true, true);
                    }.bind(this));
                }
            }
            if (this._definition.attributes) {
                await this._shelf.getKnex().schema.alterTable(this._tableName, async function (table) {
                    await this._addColumns(table, tableInfo, this._definition.attributes);
                }.bind(this));
            }
        }

        if (this._definition.attributes) {
            var junctions = this._definition.attributes.filter(function (attribute) {
                return ((attribute['dataType'] === "relation") && !attribute.via && attribute.multiple);
            });
            for (var junction of junctions) {
                try {
                    await this._addJunctionTable(junction);
                } catch (error) {
                    if (error instanceof UnknownModelError)
                        Logger.warning("[model: '" + this._name + "', attribute: '" + junction['name'] + "'] " + error['message']);
                    else
                        Logger.parseError(error, "[model: '" + this._name + "', attribute: '" + junction['name'] + "']");
                }
            }
        }

        this.createBook();
        this._bInitDone = true;
        return Promise.resolve();
    }

    async _addColumns(table, tableInfo, attributes) {
        for (let attribute of attributes) {
            if (attribute['dataType'] === "relation") {
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
                    }
                }
            }

        }
        return Promise.resolve();
    }

    _addColumn(table, attribute) {
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
                var column = table.json(attribute.name, attribute.enum);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "time":
                var column = table.time(attribute.name, attribute.enum);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "date":
                var column = table.date(attribute.name, attribute.enum);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "datetime":
                var column = table.datetime(attribute.name, attribute.enum);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                break;
            case "timestamp":
                var column = table.timestamp(attribute.name, attribute.enum);
                if (attribute.defaultValue) {
                    if (attribute.defaultValue === 'CURRENT_TIMESTAMP')
                        column.defaultTo(this._shelf.getKnex().raw('CURRENT_TIMESTAMP')); //table.timestamps(true, false);
                    else
                        column.defaultTo(attribute.defaultValue);
                }
                if (attribute.required)
                    column.notNullable();
                break;
            case "relation":
                table.integer(attribute.name);
                break;
            case "blob":
                if (attribute.length) {
                    if (attribute.length <= 65535)
                        table.binary(attribute.name, attribute.length);
                    else if (attribute.length <= 16777215)
                        table.specificType(attribute.name, "MEDIUMBLOB");
                    else
                        table.specificType(attribute.name, "LONGBLOB");
                } else {
                    table.binary(attribute.name);
                }
                break;
            case "base64":
                table.text(attribute.name, 'longtext');
                break;
            case "file":
                var column;
                if (attribute.length)
                    column = table.string(attribute.name, attribute.length);
                else
                    column = table.string(attribute.name);
                if (attribute.defaultValue)
                    column.defaultTo(attribute.defaultValue);
                if (attribute.required)
                    column.notNullable();
                if (attribute.unique)
                    column.unique();
                break;
            default:
                throw new Error("[model: '" + this._name + "', attribute: '" + attribute.name + "'] unknown datatype '" + attribute['dataType'] + "'");
        }
        Logger.info("Added column '" + attribute.name + "' to table '" + this._tableName + "'");
    }

    getJunctionTableName(attribute) {
        var relTable;
        var model = this._shelf.getModel(attribute['model']);
        if (model) {
            var modelTable = model.getTableName();
            if (this._tableName.localeCompare(modelTable) == -1)
                relTable = this._tableName + "_" + modelTable;
            else
                relTable = modelTable + "_" + this._tableName;
        }
        return relTable;
    }

    async _addJunctionTable(attribute) {
        var knex = this._shelf.getKnex();
        var model = this._shelf.getModel(attribute['model']);
        if (model) {
            var modelTable = model.getTableName();
            var relTable = this.getJunctionTableName(attribute);
            if (!await knex.schema.hasTable(relTable)) {
                var id = inflection.singularize(this._tableName) + "_id";
                var fid = inflection.singularize(modelTable) + "_id";
                await knex.schema.createTable(relTable, function (table) {
                    table.increments('id').primary();

                    table.integer(id).unsigned().notNullable().references('id').inTable(this._tableName);
                    table.integer(fid).unsigned().notNullable().references('id').inTable(modelTable);
                }.bind(this));
                Logger.info("Added table '" + relTable + "'");

                //TODO: migrate old data
                var table = knex.table(this._tableName);
                var tableInfo = await table.columnInfo();
                if (tableInfo.hasOwnProperty(attribute['name'])) {
                    var resultset = await knex.select('id as ' + id, attribute['name'] + " as " + fid).from(this._tableName).where(attribute['name'], 'is not', null);
                    console.log(resultset);
                    await knex(relTable).insert(resultset);
                    return Promise.resolve();
                }
            }
        } else
            throw new UnknownModelError("Model '" + attribute['model'] + "' is not defined");
    }

    getAttribute(name) {
        return this._definition.attributes.filter(function (x) { return x.name === name })[0];
    }

    createBook() {
        var obj = {};
        var shelf = this._shelf;

        if (this._definition.attributes) {
            for (let attribute of this._definition.attributes) {
                if (attribute['dataType'] === "relation") {
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
                            obj[attribute.name] = function () {
                                var book;
                                var model = shelf.getModel(attribute['model']);
                                if (model && model.initDone())
                                    book = model.getBook();
                                else
                                    throw new Error('Faulty model \'' + attribute['model'] + '\'');
                                return this.belongsToMany(book);
                            };
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
        this._book = this._shelf.getBookshelf().Model.extend(obj);
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

    getBook() {
        return this._book;
    }

    async read(id) {
        var res;
        if (this._bInitDone && this._book) {
            var obj = await this._book.where({ 'id': id }).fetch({
                'withRelated': this._relationNames,
                'require': true
            });
            res = obj.toJSON();
        } else
            throw new Error('Faulty model \'' + this._name + '\'');
        return Promise.resolve(res);
    }

    async readRel(query, rel, sort) {
        var res;
        var obj;
        var attr = this.getAttribute(rel);
        if (attr) {
            var name;
            if (attr.model)
                name = attr.model;
            else
                name = rel;
            var model = this._shelf.getModel(name);
            if (model) {
                if (Array.isArray(query['id'])) {
                    /*obj = await this._book.query(function (qb) {
                        qb.whereIn('id', query['id'])
                    }).fetchAll({
                        'withRelated': rel
                    });*/
                    throw new Error("Query not supported yet");
                } else {
                    obj = await this._book.forge(query).fetch({
                        'withRelated': rel
                    });
                }
                var objs = obj.related(rel);
                if (objs) {
                    if (sort) {
                        var parts = sort.split(':');
                        if (parts.length == 2) {
                            objs = objs.query('orderBy', parts[0], parts[1]);
                        }
                    }
                    obj = await objs.fetch({
                        'withRelated': model.getRelations()
                    });
                }
            }
        }
        if (obj)
            res = obj.toJSON();
        return Promise.resolve(res);
    }

    async readAll(query) {
        var res;
        var book = this._book;
        if (this._bInitDone && book) {
            if (query && Object.keys(query).length > 0) {
                var index;
                for (let prop in query) {
                    if (prop === "_sort") {
                        var parts = query[prop].split(':');
                        if (parts.length == 2) {
                            book = book.query('orderBy', parts[0], parts[1]);
                        }
                    } else if (prop === "_limit") {
                        if (query[prop] != -1) {
                            book = book.query(function (qb) {
                                qb.limit(query[prop]);
                            });
                        }
                    } else {
                        index = prop.indexOf('.');
                        if (index > 0) {
                            var propName = prop.substring(0, index);
                            if (propName === this._name) {
                                var iUnder = prop.lastIndexOf('_');
                                if (iUnder == -1) {
                                    var subProp = prop.substring(index + 1);
                                    var subAttr;
                                    for (var attribute of this._definition.attributes) {
                                        if (attribute['dataType'] === "relation" && attribute.name === subProp) {
                                            subAttr = attribute;
                                            break;
                                        }
                                    }
                                    if (subAttr) {
                                        var model = this._shelf.getModel(subAttr['model']);
                                        if (model) {
                                            var modelTable = model.getTableName();
                                            var relTable = this.getJunctionTableName(subAttr);
                                            var id = inflection.singularize(this._tableName) + "_id";
                                            var fid = inflection.singularize(modelTable) + "_id";
                                            if (Array.isArray(query[prop])) {
                                                book = book.query(function (qb) {
                                                    qb.leftJoin(relTable, this._tableName + '.id', id).whereIn(fid, query[prop]);
                                                    if (query.hasOwnProperty(prop + '_null')) {
                                                        if (query[prop + '_null'] === 'true')
                                                            qb.orWhere(fid, 'is', null);
                                                        else
                                                            qb.orWhere(fid, 'is not', null);
                                                    }
                                                }.bind(this));
                                            } else {
                                                book = book.query(function (qb) {
                                                    qb.leftJoin(relTable, this._tableName + '.id', id).where(fid, query[prop]);
                                                    if (query.hasOwnProperty(prop + '_null')) {
                                                        if (query[prop + '_null'] === 'true')
                                                            qb.orWhere(fid, 'is', null);
                                                        else
                                                            qb.orWhere(fid, 'is not', null);
                                                    }
                                                }.bind(this));
                                            }
                                        }
                                    }
                                } else {
                                    /*var subProp = prop.substring(index + 1, iUnder);
                                    var subAttr;
                                    for (var attribute of this._definition.attributes) {
                                        if (attribute['dataType'] === "relation" && attribute.name === subProp) {
                                            subAttr = attribute;
                                            break;
                                        }
                                    }
                                    if (subAttr) {
                                        var model = this._shelf.getModel(subAttr['model']);
                                        if (model) {
                                            var modelTable = model.getTableName();
                                            var relTable = this.getJunctionTableName(subAttr);
                                            var id = inflection.singularize(this._tableName) + "_id";
                                            var fid = inflection.singularize(modelTable) + "_id";
                                            if (query[prop] === "false")
                                                book = book.query(function (qb) {
                                                    qb.join(relTable, this._tableName + '.id', id).orWhere(fid, 'is not', null);
                                                }.bind(this));
                                            else
                                                book = book.query(function (qb) {
                                                    qb.join(relTable, this._tableName + '.id', id).orWhere(fid, 'is', null);
                                                }.bind(this));
                                        }
                                    }*/
                                }
                            } else {
                                var subAttr;
                                for (var attribute of this._definition.attributes) {
                                    if (attribute['dataType'] === "relation" && attribute.name === propName) {
                                        subAttr = attribute;
                                        break;
                                    }
                                }
                                if (subAttr) {
                                    var subProp = prop.substring(index + 1);
                                    if (subAttr.multiple) {
                                        var subType = subAttr.model;
                                        var relModel = this._shelf.getModel(subType);
                                        if (relModel) {
                                            if (subAttr.via) {
                                                if (subProp === 'id') {
                                                    var relObj = await relModel.read(query[prop]);
                                                    if (relObj && relObj[subAttr.via]) {
                                                        var id = relObj[subAttr.via].id;
                                                        if (id)
                                                            book = book.where({ 'id': id });
                                                    } else
                                                        return Promise.resolve();
                                                }
                                            } else {
                                                var subOpt = {};
                                                subOpt[subProp] = query[prop];
                                                return relModel.readRel(subOpt, this._name, query['_sort']); // only works if backlink property which equals modelname exists
                                            }
                                        } else
                                            return Promise.reject(new Error(`unkown type: ${subType}`));
                                    } else {
                                        if (subProp === 'id') {
                                            book = book.where(propName, query[prop]);
                                        }
                                    }
                                } else
                                    return Promise.reject(new Error(`unkown attribute '${propName}' of type '${this._name}'`));
                            }
                        } else {
                            var index = prop.lastIndexOf('_');
                            if (index == -1) {
                                if (Array.isArray(query[prop]))
                                    book = book.where(prop, 'in', query[prop]);
                                else {
                                    var obj = {};
                                    obj[prop] = query[prop];
                                    book = book.where(obj);
                                }
                            } else {
                                var end = prop.substring(index + 1);
                                var str = prop.substring(0, index);
                                switch (end) {
                                    case 'null':
                                        if (query[prop] === 'true')
                                            book = book.where(str, 'is', null); // whereNotNull
                                        else
                                            book = book.where(str, 'is not', null);
                                        break;
                                    case 'in':
                                        throw new Error("Not Implemented Yet");
                                        break;
                                    case 'nin':
                                        throw new Error("Not Implemented Yet");
                                        break;
                                    case 'contains':
                                        book = book.query(function (qb) {
                                            qb.where(str, 'is not', null).where(str, 'like', `%${query[prop]}%`);
                                        });
                                        break;
                                    case 'ncontains':
                                        book = book.query(function (qb) {
                                            qb.where(function () {
                                                this.where(str, 'is', null).orWhere(str, 'not like', `%${query[prop]}%`);
                                            });
                                        });
                                        break;
                                    case 'eq':
                                        book = book.query(function () {
                                            this.where(str, 'is not', null).where(str, 'like', query[prop]);
                                        });
                                        break;
                                    case 'neq':
                                        if (Array.isArray(query[prop])) {
                                            book = book.query(function (qb) {
                                                qb.where(function () {
                                                    this.where(str, 'is', null).orWhere(str, 'not in', query[prop]); // <> / !=
                                                });
                                            });
                                        } else {
                                            book = book.query(function (qb) {
                                                qb.where(function () {
                                                    this.where(str, 'is', null).orWhere(str, 'not like', query[prop]); // <> / !=
                                                });
                                            });
                                        }
                                        break;
                                    case 'lt':
                                        book = book.where(str, '<', query[prop]);
                                        break;
                                    case 'gt':
                                        book = book.where(str, '>', query[prop]);
                                        break;
                                    case 'lte':
                                        book = book.where(str, '<=', query[prop]);
                                        break;
                                    case 'gte':
                                        book = book.where(str, '>=', query[prop]);
                                        break;
                                    default:
                                        book = book.where(prop, query[prop]);
                                }
                            }
                        }
                    }
                }
            }
            if (!res) {
                res = await book.fetchAll({
                    'withRelated': this._relationNames
                });
            }
        } else
            throw new Error('Faulty model \'' + this._name + '\'');
        return Promise.resolve(res.toJSON());
    }

    /**
     * 
     * @param {*} data 
     * @returns object
     */
    async create(data) {
        var res;

        if (this._extension && this._extension.preCreateHook)
            data = await this._extension.preCreateHook(data);

        if (this._definition.options.increments) {
            var forge = await this._createForge(data);

            var obj = await this._book.forge(forge).save(null, { method: 'insert' });

            var id = obj['id'];
            for (var str of this._relationNames) {
                if (data[str] && Array.isArray(data[str])) {
                    var coll = obj[str]();
                    if (coll.relatedData.type === 'hasMany') { //relation via
                        var attr = this._definition.attributes.filter(function (x) { return x.name === str })[0];
                        if (attr)
                            await this._updateHasManyRelation(attr, data[str], id);
                    } else {
                        await coll.attach(data[str]);
                    }
                }
            }
            obj = await obj.load(this._relationNames);
            res = obj.toJSON();
        } else
            res = await this.upsert(data);
        return Promise.resolve(res);
    }

    async update(id, data) {
        var res;

        if (this._extension && this._extension.preUpdateHook) {
            var obj = await await this._book.where({ 'id': id }).fetch({
                'require': true
            });
            var current = obj.toJSON();
            data = await this._extension.preUpdateHook(current, data);
        }

        if (this._definition.options.increments) {
            var forge = await this._createForge(data);

            if (id) {
                if (!forge['id'])
                    forge['id'] = id;
                else if (forge['id'] !== id)
                    throw new Error("Conflict in received IDs");
            } else
                id = forge['id'];

            if (!id)
                throw new Error("ID missing");

            var obj = await this._book.forge(forge).save();
            for (var str of this._relationNames) {
                if (data[str] && Array.isArray(data[str])) {
                    var coll = obj[str]();
                    if (coll.relatedData.type === 'hasMany') { //relation via
                        var attr = this._definition.attributes.filter(function (x) { return x.name === str })[0];
                        if (attr)
                            await this._updateHasManyRelation(attr, data[str], id);
                    } else {
                        await coll.detach();
                        await coll.attach(data[str]);
                    }
                }
            }
            obj = await obj.load(this._relationNames);
            res = obj.toJSON()
        } else
            res = await this.upsert(data);
        return Promise.resolve(res);
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

    async _createForge(data) {
        var forge = {};
        var attr;
        for (var str in data) {
            if (!this._relationNames.includes(str) || !Array.isArray(data[str])) {
                attr = this._definition.attributes.filter(function (x) { return x.name === str })[0];
                if (attr) {
                    if (attr['dataType'] === "blob") {
                        forge[str] = data[str]['blob'];
                    } else if (attr['dataType'] === "base64") {
                        forge[str] = data[str]['base64'];
                    } else if (attr['dataType'] === "file") {
                        if (attr['cdn']) {
                            var cdnConfig = controller.getCdnConfig();
                            if (cdnConfig) {
                                var localPath;
                                var p;
                                for (var c of cdnConfig) {
                                    if (c['url'] === attr['cdn']) {
                                        p = c['path'];
                                        break;
                                    }
                                }
                                if (p) {
                                    if (p.startsWith('.'))
                                        localPath = path.join(controller.getAppRoot(), p);
                                    else {
                                        if (process.platform === 'linux') {
                                            if (p.startsWith('/'))
                                                localPath = p;
                                        } else
                                            localPath = p;
                                    }
                                    if (localPath) {
                                        var fileName = data[str]['filename'];
                                        if (!fileName)
                                            fileName = this._createRandomFilename(localPath, data[str]);

                                        if (fileName) {
                                            var filePath = path.join(localPath, fileName);
                                            //console.log(filePath);
                                            await this._createFile(filePath, data[str]);
                                            forge[str] = fileName;
                                        }
                                    } else
                                        throw new Error("Invalid CDN path!");
                                }
                            }
                        }
                    } else if (!attr.hasOwnProperty("persistent") || attr.persistent == true)
                        forge[str] = data[str];
                } else if (str === 'id' && this._definition.options.increments) {
                    forge[str] = data[str];
                } else
                    throw new Error("Undefined Attribute '" + str + "'");
            }
        }
        return Promise.resolve(forge);
    }

    _createRandomFilename(localPath, data) {
        var filename;

        var ext;
        if (data['url'] && data['url'].startsWith("http"))
            ext = common.getFileExtensionFromUrl(data['url']);
        else if (data['base64'] && data['base64'].startsWith("data:")) {
            var start = data['base64'].indexOf("/");
            var end = data['base64'].indexOf(";");
            if (start > 0 && end > 0)
                ext = data['base64'].substring(start + 1, end);
        }
        if (!ext)
            throw new Error("Failed to determine file extension!");

        if (fs.existsSync(localPath)) {
            try {
                do {
                    filename = crypto.randomBytes(16).toString("hex") + '.' + ext;
                } while (fs.existsSync(path.join(localPath, filename)));
            } catch (err) {
                console.error(err);
                return null;
            }
        } else
            throw new Error("Path to local CDN incorrect!");
        return filename;
    }

    async _createFile(filePath, data) {
        if (data['url'] && data['url'].startsWith("http")) {
            await webclient.download(data['url'], filePath);
        } else if (data['base64'] && data['base64'].startsWith("data:")) {
            base64.createFile(filePath, data['base64']);
        }
        return Promise.resolve();
    }

    async _updateHasManyRelation(attr, ids, id) {
        var model = this._shelf.getModel(attr['model']);
        var via = attr['via'];
        var o = {};
        o[via] = id;
        for (var i of ids) {
            await model.update(i, o);
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

        if (this._extension && this._extension.preDeleteHook)
            await this._extension.preDeleteHook(res);

        for (var attribute of this._definition.attributes) {
            if (attribute['dataType'] === "relation") {
                if (attribute['via']) {
                    //TODO: load attribute.model where id match and delete attribute.via property
                } else if (attribute['multiple']) {
                    await obj[attribute['name']]().detach();
                }
            }
        }
        if (this._definition.options.increments)
            await obj.destroy();
        else
            await this._shelf.getKnex()(this._tableName).where(id).del();

        if (this._extension && this._extension.postDeleteHook)
            await this._extension.postDeleteHook(res);

        return Promise.resolve(res);
    }
}

module.exports = Model;