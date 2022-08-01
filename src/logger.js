const fs = require('fs');

const SeverityEnum = Object.freeze({ INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR' });

class Logger {

    static info(message) {
        Logger.logMessage(SeverityEnum.INFO, message);
    }

    static warning(message) {
        Logger.logMessage(SeverityEnum.WARNING, message);
    }

    static error(message) {
        Logger.logMessage(SeverityEnum.ERROR, message);
    }

    static logMessage(severity, message) {
        var msg = new Date().toUTCString() + " [" + severity + "] " + message;
        try {
            if (severity === SeverityEnum.ERROR)
                console.error(msg);
            else
                console.log(msg);
            fs.appendFileSync('./log.txt', msg + "\r\n");
        } catch (error) {
            console.error(err);
        }
    }

    static parseError(err, msg) {
        if (msg)
            msg += " ";
        else
            msg = "";
        if (err.isAxiosError && err.response && err.response.status) { //axios
            msg += "[axios] download failed with error: " + err.response.status + " - " + err.response.statusText;
        } else if (err.code && err.sqlMessage) { //SQL/knex error
            msg += "[knex] " + err.code;
        } else if (err.name && err.name === 'CustomError' && err.message) { //?
            msg += err.message;
        } else if (err.name && err.name === 'Error' && err.message) { //custom
            msg += err.message;
        } else {
            msg += err;
        }
        console.log(err);
        Logger.error(msg);
        return msg;
    }

    _knex;

    constructor(knex) {
        this._knex = knex;
    }

    async init() {
        var exist = await this._knex.schema.hasTable('_log');
        if (!exist) {
            await this._knex.schema.createTable('_log', function (table) {
                table.increments('id').primary();
                table.timestamp('timestamp').notNullable().defaultTo(this._knex.raw('CURRENT_TIMESTAMP')); //table.timestamps(true, false);
                table.string('method');
                table.string('model');
                table.integer('record_id');
                table.json('data');
            }.bind(this));
            Logger.info("Created '_log' table");
        }
        return Promise.resolve();
    }

    async logRequest(timestamp, method, model, recordId, data) {
        var row = { 'method': method, 'model': model, 'record_id': recordId, 'data': JSON.stringify(data) };
        if (timestamp)
            row['timestamp'] = timestamp;
        return this._knex('_log').insert(row);
    }
}

module.exports = Logger;