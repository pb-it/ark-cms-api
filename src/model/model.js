const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const inflection = require('inflection');

const Logger = require(path.join(__dirname, '../common/logger/logger'));
const common = require(path.join(__dirname, '../common/common'));
const base64 = require(path.join(__dirname, '../common/base64'));
const webclient = require(path.join(__dirname, '../common/webclient'));


class Model {

    _shelf;
    _id;
    _definition;

    _name;
    _tableName;
    _relations;
    _book;

    _ePath;
    _extensions;

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
        this._relations = [];
    }

    createExtensionFile(force) {
        if (this._definition.extensions) {
            this._ePath = path.join(__dirname, "../../api/extensions/", this._name + ".js"); //NOTE: process.cwd() unsafe
            if (!fs.existsSync(this._ePath) || force)
                fs.writeFileSync(this._ePath, this._definition.extensions, { encoding: 'utf8', flag: 'w' });
            const resolved = require.resolve(this._ePath);
            if (resolved)
                delete require.cache[resolved];
        }
    }

    async initModel(bNew) {
        this.createExtensionFile(bNew);

        if (this._ePath)
            this._extensions = require(this._ePath);

        var knex = this._shelf.getKnex();
        var exist = await knex.schema.hasTable(this._tableName);
        if (!exist) {
            await knex.schema.createTable(this._tableName, function (table) {
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
            }.bind(this));
            Logger.info("Added table '" + this._tableName + "'");
        }

        if (this._definition.attributes) {
            var tableInfo = await knex.table(this._tableName).columnInfo();
            for (let attribute of this._definition.attributes) {
                try {
                    if (attribute['dataType'] === "relation") {
                        this._relations.push(attribute['name']);
                        if (!attribute.via) {
                            if (attribute.multiple) {
                                var model = this._shelf.getModel(attribute['model']);
                                if (model) {
                                    var modelTable = model.getTableName();
                                    var relTable;
                                    if (this._tableName.localeCompare(modelTable) == -1)
                                        relTable = this._tableName + "_" + modelTable;
                                    else
                                        relTable = modelTable + "_" + this._tableName;
                                    exist = await knex.schema.hasTable(relTable);
                                    if (!exist) {
                                        await knex.schema.createTable(relTable, function (table) {
                                            table.increments('id').primary();

                                            table.integer(inflection.singularize(this._tableName) + "_id").unsigned().notNullable().references('id').inTable(this._tableName);
                                            table.integer(inflection.singularize(modelTable) + "_id").unsigned().notNullable().references('id').inTable(modelTable);
                                        }.bind(this));
                                        Logger.info("Added table '" + relTable + "'");
                                    }
                                } else {
                                    throw new Error("Model '" + attribute['model'] + "' is not defined");
                                }
                            } else {
                                if (tableInfo && !tableInfo.hasOwnProperty(attribute['name']))
                                    await this._addColumn(attribute);
                            }
                        }
                    } else if ((!attribute.hasOwnProperty("persistent") || attribute.persistent === true) && tableInfo && !tableInfo.hasOwnProperty(attribute['name']))
                        await this._addColumn(attribute);
                } catch (error) {
                    if (error['message'])
                        Logger.warning("[model: '" + this._name + "', attribute: '" + attribute['name'] + "'] " + error['message']);
                    else
                        Logger.parseError(error, "[model: '" + this._name + "', attribute: '" + attribute['name'] + "']");
                }
            }
        }

        this.createBook();
        this._bInitDone = true;
        return Promise.resolve();
    }

    async _addColumn(attribute) {
        switch (attribute['dataType']) {
            case "boolean":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
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
                });
                break;
            case "integer":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column;
                    if (attribute.length)
                        column = table.integer(attribute.name, attribute.length);
                    else
                        column = table.integer(attribute.name);
                    if (attribute.unsigned)
                        column.unsigned();
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "double":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column = table.double(attribute.name);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "decimal":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column = table.decimal(attribute.name);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "string":
                await this._shelf.getKnex().transaction(function (trx) {
                    return trx.schema.alterTable(this._tableName, function (table) {
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
                            column.unique(); //could fail if there was no length specified
                    });
                }.bind(this));
                break;
            case "url":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column;
                    if (attribute.length)
                        column = table.string(attribute.name, attribute.length);
                    else
                        column = table.string(attribute.name);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "enumeration":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
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
                });
                break;
            case "text":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
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
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "json":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column = table.json(attribute.name, attribute.enum);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "time":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column = table.time(attribute.name, attribute.enum);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "date":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column = table.date(attribute.name, attribute.enum);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "datetime":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column = table.datetime(attribute.name, attribute.enum);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "timestamp":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    var column = table.timestamp(attribute.name, attribute.enum);
                    if (attribute.defaultValue)
                        column.defaultTo(attribute.defaultValue);
                    if (attribute.required)
                        column.notNullable();
                });
                break;
            case "relation":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    table.integer(attribute.name);
                });
                break;
            case "blob":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
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
                });
                break;
            case "base64":
                await this._shelf.getKnex().schema.alterTable(this._tableName, function (table) {
                    table.text(attribute.name, 'longtext');
                });
                break;
            case "file":
                await this._shelf.getKnex().transaction(function (trx) {
                    return trx.schema.alterTable(this._tableName, function (table) {
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
                    });
                }.bind(this));
                break;
            default:
                throw new Error("[model: '" + this._name + "', attribute: '" + attribute.name + "'] unknown datatype '" + attribute['dataType'] + "'");
        }
        Logger.info("Added column '" + attribute.name + "' to table '" + this._tableName + "'");
        return Promise.resolve();
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
                            var model = shelf.getModel(attribute.model);
                            if (model && model.initDone())
                                book = model.getBook();
                            else
                                throw new Error('Faulty model \'' + model.getName() + '\'');
                            return this.hasMany(book, attribute.via);
                        };
                    } else {
                        if (attribute.multiple) {
                            obj[attribute.name] = function () {
                                var book;
                                var model = shelf.getModel(attribute.model);
                                if (model && model.initDone())
                                    book = model.getBook();
                                else
                                    throw new Error('Faulty model \'' + model.getName() + '\'');
                                return this.belongsToMany(book);
                            };
                        } else {
                            obj[attribute.name] = function () {
                                var book;
                                var model = shelf.getModel(attribute.model);
                                if (model && model.initDone())
                                    book = model.getBook();
                                else
                                    throw new Error('Faulty model \'' + model.getName() + '\'');
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
        return this._relations;
    }

    getBook() {
        return this._book;
    }

    async read(id) {
        var obj = await this._book.where({ 'id': id }).fetch({
            'withRelated': this._relations,
            'require': true
        });
        return Promise.resolve(obj.toJSON());
    }

    async readRel(query, rel, sort) {
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
        return Promise.resolve(obj.toJSON());
    }

    async readAll(query) {
        var res;
        var book = this._book;
        if (this._bInitDone && book) {
            if (query) {
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
                                                        book = book.where({ 'id': id })
                                                } else
                                                    return Promise.resolve();
                                            }
                                        } else {
                                            var subOpt = {};
                                            subOpt[subProp] = query[prop];
                                            return relModel.readRel(subOpt, this._name, query['_sort']);
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
                                        if (query[prop] === "false")
                                            book = book.where(str, 'is not', null); // whereNotNull
                                        else
                                            book = book.where(str, 'is', null);
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
                    'withRelated': this._relations
                });
            }
        } else
            throw new Error('Faulty model \'' + this._name + '\'');
        return Promise.resolve(res.toJSON());
    }

    async create(data) {
        var json;

        if (this._extensions && this._extensions.prototype.create) {
            var ext = new this._extensions(data);
            await ext.create();
            data = ext.getData();
        }

        if (true) { //TODO: temporary disable creation of db-entry
            var forge = this._createForge(data);

            var obj = await this._book.forge(forge).save(null, { method: 'insert' });

            var id = obj['id'];
            for (var str of this._relations) {
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
            obj = await obj.load(this._relations);
            json = obj.toJSON();
        } else
            json = JSON.stringify({});

        return Promise.resolve(json);
    }

    async update(id, data) {
        if (this._extensions && this._extensions.prototype.update) {
            var obj = await await this._book.where({ 'id': id }).fetch({
                'require': true
            });
            var current = obj.toJSON();
            var ext = new this._extensions(current);
            data = await ext.update(data);
        }

        var forge = this._createForge(data);

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
        for (var str of this._relations) {
            if (data[str] && Array.isArray(data[str])) {
                var coll = obj[str]();
                if (coll.relatedData.type === 'hasMany') { //relation via
                    var attr = this._definition.attributes.filter(function (x) { return x.name === str })[0];
                    if (attr)
                        this._updateHasManyRelation(attr, data[str], id);
                } else {
                    await coll.detach();
                    await coll.attach(data[str]);
                }
            }
        }
        obj = await obj.load(this._relations);
        return Promise.resolve(obj.toJSON());
    }

    _createForge(data) {
        var forge = {};
        var attr;
        for (var str in data) {
            if (!this._relations.includes(str) || !Array.isArray(data[str])) {
                attr = this._definition.attributes.filter(function (x) { return x.name === str })[0];
                if (attr) {
                    if (attr['dataType'] === "blob") {
                        forge[str] = data[str]['blob'];
                    } else if (attr['dataType'] === "base64") {
                        forge[str] = data[str]['base64'];
                    } else if (attr['dataType'] === "file") {
                        if (attr['localPath']) {
                            var localPath;
                            if (attr['localPath'].startsWith('.'))
                                localPath = path.join(__dirname, '../../', attr['localPath']);
                            else {
                                if (process.platform === 'linux') {
                                    if (attr['localPath'].startsWith('/'))
                                        localPath = attr['localPath'];
                                    else
                                        throw new Error("Invalid CDN path!");
                                } else
                                    localPath = attr['localPath'];
                            }
                            if (localPath) {
                                var fileName = data[str]['filename'];
                                if (!fileName)
                                    fileName = this._createRandomFilename(localPath, data[str]);

                                if (fileName) {
                                    var filePath = path.join(localPath, fileName);
                                    //console.log(filePath);
                                    this._createFile(filePath, data[str]);
                                    forge[str] = fileName;
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
        return forge;
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

    _createFile(filePath, data) {
        if (data['url'] && data['url'].startsWith("http")) {
            webclient.download(data['url'], filePath);
        } else if (data['base64'] && data['base64'].startsWith("data:")) {
            base64.createFile(filePath, data['base64']);
        }
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
        var obj = await this._book.forge({ 'id': id }).fetch({
            'withRelated': this._relations
        });

        if (this._extensions && this._extensions.prototype.delete) {
            var ext = new this._extensions(obj.toJSON());
            await ext.delete();
        }

        for (var attribute of this._definition.attributes) {
            if (attribute['dataType'] === "relation") {
                if (attribute['via']) {
                    //TODO: load attribute.model where id match and delete attribute.via property
                } else if (attribute['multiple']) {
                    await obj[attribute['name']]().detach();
                }
            }
        }
        await obj.destroy();
        return Promise.resolve(obj.toJSON());
    }
}

module.exports = Model;