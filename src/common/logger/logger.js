const path = require('path');
const fs = require('fs');

const common = require(path.join(__dirname, "../common"));
const SeverityEnum = require(path.join(__dirname, "severity-enum"));
const LogEntry = require(path.join(__dirname, "log-entry"));

const logFile = path.join(__dirname, "../../../log.json");

const CHANGE_TABLE_NAME = '_change';

class Logger {

    static getAllEntries(sort) {
        var entries = [];
        try {
            var data = fs.readFileSync(logFile, 'utf8');
            var arr = JSON.parse(data);
            var entry;
            for (var item of arr) {
                entry = new LogEntry();
                entry.parse(item);
                entries.push(entry);
            }
            if (sort) {
                if (sort === 'asc')
                    entries.sort(function (a, b) { return new Date(a['date']) - new Date(b['date']); });
                else if (sort === 'desc')
                    entries.sort(function (a, b) { return new Date(b['date']) - new Date(a['date']); });
            }
        } catch (error) {
            console.error(error);
        }
        return entries;
    }

    static parseError(err, msg) {
        if (err) {
            if (msg)
                msg += " ";
            else
                msg = "";
            if (err.isAxiosError && err.response && err.response.status) { //axios
                msg = "[axios] download failed with error: " + err.response.status + " - " + err.response.statusText;
            } else if (err.code && err.sqlMessage) { //SQL/knex error
                msg = "[knex] " + err.code;
            } else if (err.name && err.message) { // Error/CustomError/TypeError
                msg = err.name + ": " + err.message;
            } else {
                msg = "undefined";
            }
            console.log(err);
        }
        Logger.error(msg, err);
        return msg;
    }

    static info(message) {
        Logger.logMessage(SeverityEnum.INFO, message);
    }

    static warning(message) {
        Logger.logMessage(SeverityEnum.WARNING, message);
    }

    static error(message, error) {
        Logger.logMessage(SeverityEnum.ERROR, message, error);
    }

    static logMessage(severity, message, error) {
        var err;
        if (error)
            err = common.flatten(error);
        var entry = new LogEntry(severity, message, err);
        try {
            if (severity === SeverityEnum.ERROR)
                console.error(entry.toString());
            else
                console.log(entry.toString());

            if (fs.existsSync(logFile)) {
                var fd = fs.openSync(logFile, "r+");
                var size = 1024;
                var b = Buffer.alloc(size);
                var totalDataLength = 0;
                var currentDataLength;
                do {
                    currentDataLength = fs.readSync(fd, b);
                    totalDataLength += currentDataLength;
                } while (currentDataLength === size);

                if (totalDataLength == 0) {
                    b = Buffer.from('[' + JSON.stringify(entry, null, '\t') + ']');
                    fs.writeSync(fd, b, 0, b.length, 0);
                } else if (totalDataLength > 0) {
                    b = Buffer.from(',\r\n' + JSON.stringify(entry, null, '\t') + ']');
                    fs.writeSync(fd, b, 0, b.length, totalDataLength - 1);
                }
                fs.closeSync(fd);
            } else
                fs.appendFileSync(logFile, '[' + JSON.stringify(entry, null, '\t') + ']');
        } catch (error) {
            console.error(error);
        }
    }

    _knex;

    constructor(knex) {
        this._knex = knex;
    }

    async init() {
        var exist = await this._knex.schema.hasTable(CHANGE_TABLE_NAME);
        if (!exist) {
            await this._knex.schema.createTable(CHANGE_TABLE_NAME, function (table) {
                table.increments('id').primary();
                table.timestamp('timestamp').notNullable().defaultTo(this._knex.raw('CURRENT_TIMESTAMP')); //table.timestamps(true, false);
                table.string('method');
                table.string('model');
                table.integer('record_id');
                table.json('data');
            }.bind(this));
            Logger.info("Created '" + CHANGE_TABLE_NAME + "' table");
        }
        return Promise.resolve();
    }

    async logChange(timestamp, method, model, recordId, data) {
        var row = { 'method': method, 'model': model, 'record_id': recordId, 'data': JSON.stringify(data) };
        if (timestamp)
            row['timestamp'] = timestamp;
        return this._knex(CHANGE_TABLE_NAME).insert(row);
    }
}

module.exports = Logger;