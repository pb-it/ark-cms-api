const inflection = require('inflection');

const OPERATORS = ['null', 'in', 'nin', 'contains', 'ncontains', 'eq', 'neq', 'regex', 'nregex'];
const OPERATORS_NUMBER = ['lt', 'gt', 'lte', 'gte'];
const OPERATORS_MULTI_REL = ['null', 'count', 'any', 'none', 'every'];

class QueryParser {

    static _parse(query) {
        var obj = {};
        var keys = Object.keys(query);
        if (keys.length > 0) {
            if (keys.length == 1) {
                var prop = keys[0];
                if (prop === '$or')
                    obj = { 'operator': 'or', 'args': QueryParser._parseArgs(query[prop]) };
                else if (prop === '$and')
                    obj = { 'operator': 'and', 'args': QueryParser._parseArgs(query[prop]) };
                else if (!prop.startsWith('_'))
                    obj = { 'operator': 'eq', 'field': prop, 'value': query[prop] }
            } else
                obj = { 'operator': 'and', 'args': QueryParser._parseArgs(query) };
        }
        return obj;
    }

    static _parseArgs(obj) {
        var args;
        var keys = Object.keys(obj);
        if (keys.length > 0) {
            args = [];
            for (let key in obj) {
                if (key === '$or')
                    args.push({ 'operator': 'or', 'args': QueryParser._parseArgs(obj[key]) });
                else if (key === '$and')
                    args.push({ 'operator': 'and', 'args': QueryParser._parseArgs(obj[key]) });
                else
                    args.push({ 'operator': 'eq', 'field': key, 'value': obj[key] });
            }
        }
        return args;
    }

    _model;
    _book;
    _obj;
    _bFirst;
    _bOr;
    _joins;
    _leftJoins;

    constructor(model) {
        this._model = model;
        this._book = model.getBook();
        this._bFirst = true;
        this._bOr = false;
        this._joins = [];
        this._leftJoins = [];
    }

    async executeQuery(query) {
        if (Object.keys(query).length > 0) {
            var copy = {};
            for (let [key, value] of Object.entries(query)) {
                if (!key.startsWith('_') || key === '$field')
                    copy[key] = value;
            }
            if (Object.keys(copy).length > 0) {
                this._obj = QueryParser._parse(copy);
                if (Object.keys(this._obj).length > 0)
                    await this.queryObj(this._obj);
            }
            if (query.hasOwnProperty('_sort')) {
                var parts = query['_sort'].split(':');
                if (parts.length == 2)
                    this._book = await this._book.query(function (qb) {
                        this.orderBy(parts[0], parts[1]);
                    });
            }
            if (query.hasOwnProperty('_limit')) {
                if (query['_limit'] != -1)
                    this._book = await this._book.query(function (qb) {
                        this.limit(query['_limit']);
                    });
            }
        }
        return this.finalizeQuery();
    }

    async queryObj(obj, bExec = true) {
        var func;
        if (obj['operator'] === 'or' || obj['operator'] === 'and') {
            var arr = [];
            var fn;
            for (var q of obj['args']) {
                fn = await this.queryObj(q, obj['operator'] !== 'or' && obj['operator'] !== 'and');
                if (fn)
                    arr.push(fn);
            }
            if (arr.length > 0) {
                this._book = await this._book.query(function (qb) {
                    if (arr.length == 1) {
                        if (obj['operator'] === 'or') {
                            if (this._bFirst) { // knex may rearrange query - 'or' on first part have to be switched/delayed
                                qb.where(arr[0]);
                                this._bOr = true;
                            } else
                                qb.orWhere(arr[0]);
                        } else
                            qb.where(arr[0]);
                    } else {
                        let fn;
                        if (obj['operator'] === 'or')
                            fn = function (oqb) {
                                for (var fx of arr)
                                    oqb.orWhere(fx);
                            };
                        else
                            fn = function (oqb) {
                                for (var fx of arr) {
                                    fx(oqb);
                                    //console.log(oqb.toSQL());
                                }
                            };
                        if (this._bOr)
                            qb.orWhere(fn);
                        else
                            qb.where(fn);
                        //console.log(qb.toSQL());
                    }
                    this._bFirst = false;
                }.bind(this));
            }
        } else {
            var fn = this._query(obj['field'], obj['value']);
            if (fn) {
                if (bExec) {
                    this._book = await this._book.query(function (qb) {
                        fn(qb);
                    }.bind(this));
                } else
                    func = fn;
            } else
                throw new Error(`Unsupported query: ${obj['field']}=${obj['value']}`);
        }
        return Promise.resolve(func);
    }

    async finalizeQuery() {
        if (this._joins.length > 0) {
            var tableName = this._model._tableName;
            var id = inflection.singularize(tableName) + "_id";
            for (let a of this._joins) {
                this._book = await this._book.query(function (qb) {
                    qb.join(a, tableName + '.id', a + '.' + id);
                    //console.log(qb.toSQL());
                });
            }
        }
        if (this._leftJoins.length > 0) {
            var tableName = this._model._tableName;
            var id = inflection.singularize(tableName) + "_id";
            for (let a of this._leftJoins) {
                this._book = await this._book.query(function (qb) {
                    qb.leftJoin(a, tableName + '.id', a + '.' + id);
                    //console.log(qb.toSQL());
                });
            }
        }
        return Promise.resolve(this._book);
    }

    _query(prop, value) {
        var fn;
        var index = prop.indexOf('.');
        if (index == -1) {
            var tmp;
            var propName;
            var operator;
            var operator2;

            index = prop.lastIndexOf('_');
            if (index == -1)
                propName = prop;
            else {
                var tmp = prop.substring(0, index);
                var end = prop.substring(index + 1);
                if (OPERATORS_NUMBER.includes(end)) {
                    propName = tmp;
                    operator = end;
                    index = tmp.lastIndexOf('_');
                    if (index != -1) {
                        end = tmp.substring(index + 1);
                        if (end === 'count') {
                            operator2 = operator;
                            operator = end;
                            propName = tmp.substring(0, index);
                        }
                    }
                } else if (OPERATORS.includes(end) || OPERATORS_MULTI_REL.includes(end)) {
                    propName = tmp;
                    operator = end;
                } else
                    propName = prop;
            }

            var relAttr;
            for (var attribute of this._model.getDefinition().attributes) {
                if (attribute['name'] == propName) {
                    if (attribute['dataType'] == "relation")
                        relAttr = attribute;
                    else if (attribute['dataType'] == "boolean") {
                        if (!operator) {
                            if (value == 'true' || value == 'on')
                                value = '1';
                            else if (value == 'false' || value == 'off')
                                value = '0';
                        }
                    }
                    break;
                }
            }
            if (relAttr && relAttr['multiple']) {
                var val;
                if (operator == 'null' || operator == 'count')
                    val = value;
                else {
                    if (Array.isArray(value))
                        val = value;
                    else if (typeof value === 'string' || value instanceof String) {
                        if (value.indexOf(',') == -1)
                            val = value;
                        else
                            val = value.split(',').map(Number);
                    } else
                        val = value;
                }
                if (!operator)
                    operator = 'any';
                if (relAttr['via'])
                    fn = this._queryViaRelation(relAttr, operator, operator2, val);
                else
                    fn = this._queryRelation(relAttr, operator, operator2, val);
            } else {
                if (operator) {
                    if (OPERATORS.includes(operator) || OPERATORS_NUMBER.includes(operator))
                        fn = this._queryComparisonOperation(propName, operator, value);
                    else
                        throw new Error(`unkown operator: ${operator}`);
                } else {
                    fn = function (qb) {
                        if (Array.isArray(value))
                            qb.where(propName, 'in', value);
                        else
                            qb.where(propName, value);
                    };
                }
            }
        }
        return fn;
    }

    _queryViaRelation(relAttr, operation, operator2, value) {
        var fn;
        const subType = relAttr['model'];
        const relModel = this._model.getShelf().getModel(subType);
        if (relModel) {
            const tableName = this._model.getTableName();
            const relModelTable = relModel.getTableName();

            const id = tableName + '.id';
            const fid = relModelTable + '.' + relAttr['via'];

            fn = function (qb) {
                switch (operation) {
                    case 'null':
                        qb.leftJoin(relModelTable, id, fid);
                        if (value === '' || value === 'true')
                            qb.where(fid, 'is', null);
                        else
                            qb.where(fid, 'is not', null);
                        break;
                    case 'count':
                        var count = parseInt(value);
                        if (count == 0 && !operator2) {
                            qb.whereRaw(id + ' NOT IN (SELECT ' + fid + ' FROM ' + relModelTable + ' WHERE ' + fid + ' IS NOT null)');
                        } else {
                            var op;
                            var bIncludeZero;
                            if (operator2) {
                                bIncludeZero = operator2 === 'lt' || operator2 === 'lte' || (operator2 === 'gte' && count == 0);
                                switch (operator2) {
                                    case 'lt':
                                        op = '<';
                                        break;
                                    case 'gt':
                                        op = '>';
                                        break;
                                    case 'lte':
                                        op = '<=';
                                        break;
                                    case 'gte':
                                        op = '>=';
                                        break;
                                    default:
                                        throw new Error('Operator \'' + operator2 + '\' not supported');
                                }
                            } else
                                op = '=';
                            if (bIncludeZero) {
                                qb.whereIn(id, function (qb) {
                                    qb.select(id)
                                        .from(tableName)
                                        .whereRaw(id + ' NOT IN (SELECT ' + fid + ' FROM ' + relModelTable + ' WHERE ' + fid + ' IS NOT null)');
                                    qb.union(function (qb) {
                                        qb.select(id)
                                            .from(tableName)
                                            .join(relModelTable, id, fid)
                                            .groupBy(id)
                                            .havingRaw('COUNT(*) ' + op + ' ?', [count])
                                    }, true);
                                });
                            } else {
                                qb.whereIn(id, function (qb) {
                                    qb.select(id)
                                        .from(tableName)
                                        .join(relModelTable, id, fid)
                                        .groupBy(id)
                                        .havingRaw('COUNT(*) ' + op + ' ?', [count])
                                });
                            }
                        }
                        break;
                    case 'any': // containsAny / includesSome
                        qb.join(relModelTable, id, fid);
                        if (Array.isArray(value))
                            qb.whereIn(relModelTable + '.id', value);
                        else
                            qb.where(relModelTable + '.id', value);
                        break;
                    case 'none':
                        if (Array.isArray(value))
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + fid + ' FROM ' + relModelTable + ' WHERE ' + relModelTable + '.id IN (' + value.join(', ') + ') )');
                        else
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + fid + ' FROM ' + relModelTable + ' WHERE ' + relModelTable + '.id = ' + value + ' )');
                        break;
                    case 'every': // containsAll / includesEvery
                        qb.join(relModelTable, id, fid);
                        if (Array.isArray(value)) {
                            qb.whereIn(relModelTable + '.id', value)
                                .groupBy(id)
                                .havingRaw('COUNT(*) >= ?', value.length);
                        } else
                            qb.where(relModelTable + '.id', value);
                        break;
                    default:
                        throw new Error(`unkown operator: ${operation}`);
                }
            };
        } else
            throw new Error(`unkown type: ${subType}`);
        return fn;
    }

    _queryRelation(relAttr, operation, operator2, value) {
        var fn;
        var subType = relAttr['model'];
        var relModel = this._model.getShelf().getModel(subType);
        if (relModel) {
            var tableName = this._model.getTableName();
            var relModelTable = relModel.getTableName();
            var junctionTable = this._model.getJunctionTableName(relAttr);
            var id = tableName + ".id";
            var jid = inflection.singularize(tableName) + "_id";
            var fid = inflection.singularize(relModelTable) + "_id";
            if (operation != 'count') {
                if (this._leftJoins.indexOf(junctionTable) == -1)
                    this._leftJoins.push(junctionTable);
            }

            fn = function (qb) {
                switch (operation) {
                    case 'null':
                        if (value === '' || value === 'true')
                            qb.where(fid, 'is', null);
                        else
                            qb.where(fid, 'is not', null);
                        break;
                    case 'count':
                        var count = parseInt(value);
                        if (count == 0 && !operator2) {
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + jid + ' FROM ' + junctionTable + ')');
                        } else {
                            var op;
                            var bIncludeZero;
                            if (operator2) {
                                bIncludeZero = operator2 === 'lt' || operator2 === 'lte' || (operator2 === 'gte' && count == 0);
                                switch (operator2) {
                                    case 'lt':
                                        op = '<';
                                        break;
                                    case 'gt':
                                        op = '>';
                                        break;
                                    case 'lte':
                                        op = '<=';
                                        break;
                                    case 'gte':
                                        op = '>=';
                                        break;
                                    default:
                                        throw new Error('Operator \'' + operator2 + '\' not supported');
                                }
                            } else
                                op = '=';

                            if (bIncludeZero) {
                                qb.whereIn(id, function (qb) {
                                    qb.select(id)
                                        .from(tableName)
                                        .whereRaw(tableName + '.id NOT IN (SELECT ' + jid + ' FROM ' + junctionTable + ')');
                                    qb.union(function (qb) {
                                        qb.select(id)
                                            .from(tableName)
                                            .join(junctionTable, id, jid)
                                            .groupBy(id)
                                            .havingRaw('COUNT(*) ' + op + ' ?', [count]);
                                    }, true);
                                });
                            } else {
                                qb.whereIn(id, function (qb) {
                                    qb.select(id)
                                        .from(tableName)
                                        .join(junctionTable, id, jid)
                                        .groupBy(id)
                                        .havingRaw('COUNT(*) ' + op + ' ?', [count]);
                                });
                            }
                        }
                        //console.log(qb.toSQL());
                        break;
                    case 'any': // containsAny / includesSome
                        if (Array.isArray(value))
                            qb.whereIn(fid, value);
                        else
                            qb.where(fid, value);
                        break;
                    case 'none':
                        if (Array.isArray(value))
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + jid + ' FROM ' + junctionTable + ' WHERE ' + fid + ' IN (' + value.join(', ') + ') )');
                        else
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + jid + ' FROM ' + junctionTable + ' WHERE ' + fid + ' = ' + value + ' )');
                        break;
                    case 'every': // containsAll / includesEvery
                        if (Array.isArray(value)) {
                            qb.whereIn(fid, value)
                                .groupBy(junctionTable + '.' + jid)
                                .havingRaw('COUNT(*) >= ?', value.length);
                        } else
                            qb.where(fid, value);
                        break;
                    default:
                        throw new Error(`unkown operator: ${operation}`);
                }
            };
        } else
            throw new Error(`unkown type: ${subType}`);
        return fn;
    }

    _queryComparisonOperation(propName, operator, value) {
        var prop = this._model.getTableName() + '.' + propName;
        const def = this._model.getDefinition();
        var dataType;
        if ((propName === 'created_at' || propName === 'updated_at') && def.options.timestamps)
            dataType = 'timestamp';
        for (var attribute of def.attributes) {
            if (attribute['name'] == propName) {
                dataType = attribute['dataType'];
                break;
            }
        }
        if (dataType === 'timestamp') {
            if (value.endsWith('Z')) // MySQL ignores 'Z' and would convert value to UTC with timezone provided by connection 
                value = value.substring(0, value.length - 1) + '+00:00';
        }

        return function (qb) {
            switch (operator) {
                case 'null':
                    if (value === '' || value === 'true')
                        qb.where(prop, 'is', null); // whereNotNull
                    else
                        qb.where(prop, 'is not', null);
                    break;
                case 'in':
                    qb.where(function () {
                        if (Array.isArray(value))
                            this.where(prop, 'is not', null).where(prop, 'in', value);
                        else
                            this.where(prop, 'is not', null).where(prop, 'in', value.split(','));
                    });
                    break;
                case 'nin':
                    qb.where(function () {
                        if (Array.isArray(value))
                            this.where(prop, 'is', null).orWhere(prop, 'not in', value);
                        else
                            this.where(prop, 'is', null).orWhere(prop, 'not in', value.split(','));
                    });
                    break;
                case 'contains':
                    qb.where(function () {
                        this.where(prop, 'is not', null).where(prop, 'like', `%${value}%`);
                    });
                    break;
                case 'ncontains':
                    qb.where(function () {
                        this.where(prop, 'is', null).orWhere(prop, 'not like', `%${value}%`);
                    });
                    break;
                case 'eq':
                    qb.where(prop, 'is not', null);
                    if (Array.isArray(value)) {
                        if (value.length > 0) {
                            qb.where(function () {
                                var bFirst = true;
                                for (var val of value) {
                                    if (bFirst) {
                                        this.where(prop, 'like', val);
                                        bFirst = false;
                                    } else
                                        this.orWhere(prop, 'like', val);
                                }
                            });
                        }
                    } else
                        qb.where(prop, 'like', value);
                    break;
                case 'neq':
                    qb.where(function () {
                        if (Array.isArray(value))
                            this.where(prop, 'is', null).orWhere(prop, 'not in', value); // <> / !=
                        else
                            this.where(prop, 'is', null).orWhere(prop, 'not like', value); // <> / !=
                    });
                    break;
                case 'regex':
                    qb.whereRaw(`${prop} REGEXP '${value}'`);
                    break;
                case 'nregex':
                    qb.whereRaw(`${prop} NOT REGEXP '${value}'`);
                    break;
                case 'lt':
                    qb.where(prop, '<', value);
                    break;
                case 'gt':
                    qb.where(prop, '>', value);
                    break;
                case 'lte':
                    qb.where(prop, '<=', value);
                    break;
                case 'gte':
                    qb.where(prop, '>=', value);
                    break;
                default:
                    //qb.where(prop, value);
                    throw new Error(`unkown operator: ${operator}`);
            }
        }
    }
}

module.exports = QueryParser;