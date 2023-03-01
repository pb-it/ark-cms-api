const inflection = require('inflection');

class QueryParser {

    _model;
    _book;
    _joins;

    constructor(model, book) {
        this._model = model;
        this._book = book; //model.getBook();
        this._joins = [];
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
            this._book = this._book.query(function (qb) {
                fn(qb);
            }.bind(this));
        }
    }

    finalizeQuery() {
        if (this._joins.length > 0) {
            var tableName = this._model._tableName;
            var id = inflection.singularize(tableName) + "_id";
            for (let a of this._joins) {
                this._book = this._book.query(function (qb) {
                    qb.leftJoin(a, tableName + '.id', id);
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
                propName = prop.substring(0, index);
                operator = prop.substring(index + 1);
            }

            var relAttr;
            for (var attribute of this._model.getDefinition().attributes) {
                if (attribute['dataType'] == "relation" && attribute['name'] == propName) {
                    relAttr = attribute;
                    break;
                }
            }
            if (relAttr && relAttr['multiple']) {
                var via = relAttr['via'];
                if (via) {
                    throw new Error("Not Implemented Yet");
                } else {
                    var val;
                    if (operator == 'null')
                        val = value;
                    else {
                        if (Array.isArray(value))
                            val = value;
                        else if (typeof value === 'string' || value instanceof String)
                            val = value.split(',').map(Number);
                    }
                    if (!operator)
                        operator = 'containsAny';
                    fn = this._queryRelation(relAttr, operator, val);
                }
            } else {
                if (operator)
                    fn = this._queryComparisonOperation(propName, operator, value);
                else {
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

    _queryRelation(relAttr, operation, value) {
        var fn;
        var subType = relAttr['model'];
        var relModel = this._model.getShelf().getModel(subType);
        if (relModel) {
            var tableName = this._model._tableName;
            var relModelTable = relModel.getTableName();
            var junctionTable = this._model.getJunctionTableName(relAttr);
            var id = inflection.singularize(tableName) + "_id";
            var fid = inflection.singularize(relModelTable) + "_id";

            if (this._joins.indexOf(junctionTable) == -1)
                this._joins.push(junctionTable);

            fn = function (qb) {
                switch (operation) {
                    case 'null':
                        if (value === 'true')
                            qb.where(fid, 'is', null);
                        else
                            qb.where(fid, 'is not', null);
                        break;
                    case 'containsAny': // includesSome
                        if (Array.isArray(value))
                            qb.whereIn(fid, value);
                        else
                            qb.where(fid, value);
                        break;
                    case 'ncontainsAny':
                        if (Array.isArray(value))
                            qb.whereRaw(tableName + '.id NOT IN (SELECT ' + id + ' FROM ' + junctionTable + ' WHERE ' + fid + ' IN (?) )', value);
                        else
                            qb.where(fid, 'is not', value);
                        break;
                    case 'containsAll': // includesEvery
                        if (Array.isArray(value)) {
                            qb.whereIn(fid, value)
                                .groupBy(id)
                                .havingRaw('COUNT(*) >= ?', value.length);
                        } else
                            qb.where(fid, value);
                        break;
                }
            };
        } else
            throw new Error(`unkown type: ${subType}`);
        return fn;
    }

    _queryComparisonOperation(propName, operator, value) {
        return function (qb) {
            switch (operator) {
                case 'null':
                    if (value === 'true')
                        qb.where(propName, 'is', null); // whereNotNull
                    else
                        qb.where(propName, 'is not', null);
                    break;
                case 'in':
                    throw new Error("Not Implemented Yet");
                case 'nin':
                    throw new Error("Not Implemented Yet");
                case 'contains':
                    qb.where(propName, 'is not', null).where(propName, 'like', `%${value}%`);
                    break;
                case 'ncontains':
                    qb.where(propName, 'is', null).orWhere(propName, 'not like', `%${value}%`);
                    break;
                case 'eq':
                    qb.where(propName, 'is not', null);
                    if (Array.isArray(value)) {
                        if (value.length > 0) {
                            qb.where(function () {
                                var bFirst = true;
                                for (var val of value) {
                                    if (bFirst) {
                                        qb.where(propName, 'like', val);
                                        bFirst = false;
                                    } else
                                        qb.orWhere(propName, 'like', val);
                                }
                            });
                        }
                    } else
                        qb.where(propName, 'like', value);
                    break;
                case 'neq':
                    if (Array.isArray(value))
                        qb.where(propName, 'is', null).orWhere(propName, 'not in', value); // <> / !=
                    else
                        qb.where(propName, 'is', null).orWhere(propName, 'not like', value); // <> / !=
                    break;
                case 'lt':
                    qb.where(propName, '<', value);
                    break;
                case 'gt':
                    qb.where(propName, '>', value);
                    break;
                case 'lte':
                    qb.where(propName, '<=', value);
                    break;
                case 'gte':
                    qb.where(propName, '>=', value);
                    break;
                default:
                    qb.where(propName, value);
            }
        }
    }
}

module.exports = QueryParser;