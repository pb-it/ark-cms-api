const fs = require('fs');

class Logger {

    static info(message) {
        var msg = new Date().toUTCString() + " [info] " + message;
        try {
            console.log(msg);
            fs.appendFileSync('./log.txt', msg + "\n");
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

    static error(message) {
        var msg = new Date().toUTCString() + " [error] " + message + "\r\n";
        try {
            console.error(msg);
            fs.appendFileSync('./log.txt', msg);
        } catch (error) {
            console.error(err);
        }
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