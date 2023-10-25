const inflection = require('inflection');

const OPERATORS = ['null', 'in', 'nin', 'contains', 'ncontains', 'eq', 'neq', 'regex', 'nregex', 'lt', 'gt', 'lte', 'gte'];
const OPERATORS_MULTI_REL = ['null', 'count', 'any', 'none', 'every'];

class QueryParser {

    _model;
    _book;
    _joins;
    _leftJoins;

    constructor(model, book) {
        this._model = model;
        this._book = book; //model.getBook();
        this._joins = [];
        this._leftJoins = [];
    }

    getBook() {
        return this._book;
    }

    setBook(book) {
        this._book = book;
    }

    query(prop, value) {
        if (prop == 'or') {
            var fn;
            this._book = this._book.query(function (qb) {
                if (Array.isArray(value)) { //TODO: parathesed queries fail currently because of missing joins
                    qb.where(function (oqb) {
                        var fn;
                        for (var q of value) {
                            for (const [p, v] of Object.entries(q)) {
                                fn = this._query(p, v);
                                //fn(oqb);
                                oqb.orWhere(fn.bind(this));
                            }
                        }
                    }.bind(this));
                } else {
                    for (const [p, v] of Object.entries(value)) {
                        qb.orWhere(this._query(p, v));
                    }
                }
            }.bind(this));
        } else {
            var fn = this._query(prop, value);
            if (fn) {
                this._book = this._book.query(function (qb) {
                    fn(qb);
                }.bind(this));
            } else
                throw new Error(`Unsupported query: ${prop}=${value}`);
        }
    }

    finalizeQuery() {
        if (this._joins.length > 0) {
            var tableName = this._model._tableName;
            var id = inflection.singularize(tableName) + "_id";
            for (let a of this._joins) {
                this._book = this._book.query(function (qb) {
                    qb.join(a, tableName + '.id', a + '.' + id);
                    //console.log(qb.toSQL());
                });
            }
        }
        if (this._leftJoins.length > 0) {
            var tableName = this._model._tableName;
            var id = inflection.singularize(tableName) + "_id";
            for (let a of this._leftJoins) {
                this._book = this._book.query(function (qb) {
                    qb.leftJoin(a, tableName + '.id', a + '.' + id);
                    //console.log(qb.toSQL());
                });
            }
        }
        return this._book;
    }

    _query(prop, value) {
        var fn;
        var index = prop.indexOf('.');
        if (index == -1) {
            var propName;
            var operator;

            index = prop.lastIndexOf('_');
            if (index == -1)
                propName = prop;
            else {
                var end = prop.substring(index + 1);
                if (OPERATORS.includes(end) || OPERATORS_MULTI_REL.includes(end)) {
                    propName = prop.substring(0, index);
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
                    }
                }
                if (!operator)
                    operator = 'any';
                if (relAttr['via'])
                    fn = this._queryViaRelation(relAttr, operator, val);
                else
                    fn = this._queryRelation(relAttr, operator, val);
            } else {
                if (operator) {
                    if (OPERATORS.includes(operator))
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

    _queryViaRelation(relAttr, operation, value) {
        var fn;
        var subType = relAttr['model'];
        var relModel = this._model.getShelf().getModel(subType);
        if (relModel) {
            var tableName = this._model.getTableName();
            var relModelTable = relModel.getTableName();

            var id = tableName + '.id';
            var fid = relModelTable + '.' + relAttr['via'];

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
                        if (count == 0) {
                            qb.whereRaw(id + ' NOT IN (SELECT ' + fid + ' FROM ' + relModelTable + ' WHERE ' + fid + ' IS NOT null)');
                        } else if (count > 0) {
                            qb.join(relModelTable, id, fid);
                            qb.groupBy(id)
                                .havingRaw('COUNT(*) = ?', [count]);
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

    _queryRelation(relAttr, operation, value) {
        var fn;
        var subType = relAttr['model'];
        var relModel = this._model.getShelf().getModel(subType);
        if (relModel) {
            var tableName = this._model.getTableName();
            var relModelTable = relModel.getTableName();
            var junctionTable = this._model.getJunctionTableName(relAttr);
            var id = inflection.singularize(tableName) + "_id";
            var fid = inflection.singularize(relModelTable) + "_id";
            if (operation != 'count' || parseInt(value) == 0) {
                if (this._leftJoins.indexOf(junctionTable) == -1)
                    this._leftJoins.push(junctionTable);
            } else {
                if (this._joins.indexOf(junctionTable) == -1)
                    this._joins.push(junctionTable);
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
                        if (count == 0) {
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + id + ' FROM ' + junctionTable + ')');
                        } else if (count > 0) {
                            qb.groupBy(id)
                                .havingRaw('COUNT(*) = ?', [count]);
                        }
                        break;
                    case 'any': // containsAny / includesSome
                        if (Array.isArray(value))
                            qb.whereIn(fid, value);
                        else
                            qb.where(fid, value);
                        break;
                    case 'none':
                        if (Array.isArray(value))
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + id + ' FROM ' + junctionTable + ' WHERE ' + fid + ' IN (' + value.join(', ') + ') )');
                        else
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + id + ' FROM ' + junctionTable + ' WHERE ' + fid + ' = ' + value + ' )');
                        break;
                    case 'every': // containsAll / includesEvery
                        if (Array.isArray(value)) {
                            qb.whereIn(fid, value)
                                .groupBy(junctionTable + '.' + id)
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
        for (var attribute of this._model.getDefinition().attributes) {
            if (attribute['name'] == propName) {
                if (attribute['dataType'] == "timestamp")
                    if (value.endsWith('Z')) // MySQL ignores 'Z' and would convert value to UTC with timezone provided by connection 
                        value = value.substring(0, value.length - 1) + '+00:00';
                break;
            }
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