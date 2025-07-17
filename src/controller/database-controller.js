const common = require('../common/common');
const Logger = require('../common/logger/logger');

class DatabaseController {

    _config;
    _settings;
    _knex;

    constructor() {
    }

    async init(config, bDebug) {
        this._config = config;

        const defaultConnection = this._config['defaultConnection'];
        if (defaultConnection && this._config['connections'] && this._config['connections'][defaultConnection])
            this._settings = this._config['connections'][defaultConnection]['settings'];
        else
            throw new Error('Faulty database configuration!');

        const connection = this._settings['connection'];
        if (this._settings['client'].startsWith('mysql') && !connection['dateStrings'] && !connection['typeCast']) {
            Logger.info("[knex] Appling type casting function for 'DATE'");
            connection['typeCast'] = function (field, next) {
                if (field.type === 'DATE')
                    return field.string();
                else
                    return next();
            }
        }
        this._knex = require('knex')(this._settings);

        if (bDebug) {
            this._knex.on('query', function (queryData) {
                console.log(queryData);
            });
        }

        try {
            await this._knex.raw('select 1+1 as result');
            Logger.info("[knex] ✔ Successfully connected to " + this._settings['client'] + " on " + this._settings['connection']['host']);
        } catch (error) {
            if (process.env.NODE_ENV !== 'test') {
                Logger.parseError(error, "[knex] ER_ACCESS_DENIED_ERROR");
                process.exit(1);
            } else
                throw error;
        }

        return Promise.resolve();
    }

    getDatabaseConfig() {
        return this._config;
    }

    getDatabaseSettings() {
        return this._settings;
    }

    getDatabaseClientName() {
        return this._settings['client'];
    }

    getKnex() {
        return this._knex;
    }

    async createDatabaseBackup(file, password) {
        if (this._settings && this._settings['client'].startsWith('mysql')) {
            var cmd;
            if (process.platform === 'linux')
                cmd = 'mysqldump';
            else if (process.platform === 'win32')
                cmd = 'mysqldump.exe';
            else
                throw new Error(`Unsupported Platform: '${process.platform}'`);
            var bRemote;
            if (this._settings['connection']['host'] !== 'localhost' && this._settings['connection']['host'] !== '127.0.0.1') {
                bRemote = true;
                cmd += ' --host=' + this._settings['connection']['host'];
            }
            if (this._settings['connection'].hasOwnProperty('port') && this._settings['connection']['port'] !== '3306')
                cmd += ' --port=' + this._settings['connection']['port'];
            if (bRemote)
                cmd += ' --protocol=tcp';
            cmd += ' --verbose --user=' + this._settings['connection']['user'];

            if (!password)
                password = this._settings['connection']['password'];
            if (password)
                cmd += ' --password=' + password;

            cmd += ` --single-transaction=TRUE --skip-lock-tables --add-drop-database --opt --skip-set-charset --default-character-set=utf8mb4 --databases cms > ${file}`;
            // --column-statistics=0 --skip-triggers
            Logger.info("[App] Creating database dump to '" + file + "'");
            await common.exec(cmd);
        } else
            throw new Error('By now backup/restore API is only supports MySQL databases!');
        return Promise.resolve();
    }

    async restoreDatabaseBackup(file, password) {
        if (this._settings && this._settings['client'].startsWith('mysql')) {
            var cmd;
            if (process.platform === 'linux')
                cmd = 'mysql';
            else if (process.platform === 'win32')
                cmd = 'mysql.exe';
            else
                throw new Error(`Unsupported Platform: '${process.platform}'`);
            var bRemote;
            if (this._settings['connection']['host'] !== 'localhost' && this._settings['connection']['host'] !== '127.0.0.1') {
                bRemote = true;
                cmd += ' --host=' + settings['connection']['host'];
            }
            if (this._settings['connection'].hasOwnProperty('port') && this._settings['connection']['port'] !== '3306')
                cmd += ' --port=' + this._settings['connection']['port'];
            if (bRemote)
                cmd += ' --protocol=tcp';
            cmd += ' --verbose --user=' + this._settings['connection']['user'];
            if (!password)
                password = this._settings['connection']['password'];
            if (password)
                cmd += ' --password=' + password;
            cmd += '< ' + file['path'];
            // --comments
            Logger.info("[App] Restoring Database");
            await common.exec(cmd);
        } else
            throw new Error('By now backup/restore API is only supports MySQL databases!');
        return Promise.resolve();
    }

    async clearSchema(schema) {
        if (!schema)
            schema = this._settings['connection']['database'];
        Logger.info("Clearing database '" + schema + "'");
        var rs = await this._knex.raw("DROP DATABASE " + schema + ";");
        rs = await this._knex.raw("CREATE DATABASE " + schema + ";");
        return Promise.resolve('OK');
    }
}

module.exports = DatabaseController;