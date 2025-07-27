const path = require('path');

class FileStorageController {

    _controller;
    _entries;

    constructor(controller) {
        this._controller = controller;
    }

    async init(entries) {
        this._entries = entries;
        var tmp = await this._controller.getRegistry().get('sys.fileStorage');
        if (tmp) {
            var fileStorage = JSON.parse(tmp);
            if (this._entries) {
                var names = this._entries.map(x => x['name']);
                for (var x of fileStorage) {
                    if (names.indexOf(x['name']) == -1)
                        this._entries.push(x);
                }
            } else
                this._entries = fileStorage;
        }
        const info = this._controller.getInfo();
        info['cdn'] = this._entries.map(function (x) { return { 'url': x['url'] } });
        return Promise.resolve();
    }

    addEntry(entry) {
        if (this._entries)
            this._entries.push(entry);
        else
            this._entries = [entry];
        controller.getWebServer().addStorageRoute(entry);
        const info = this._controller.getInfo();
        info['cdn'] = this._entries.map(function (x) { return { 'url': x['url'] } });
    }

    getEntries() {
        return this._entries;
    }

    getPathForFile(attr) {
        var localPath;
        if (this._entries) {
            var p;
            for (var c of this._entries) {
                if (c['url'] === attr['cdn']) {
                    p = c['path'];
                    break;
                }
            }
            if (p) {
                if (p.startsWith('.'))
                    localPath = path.join(this._controller.getAppRoot(), p);
                else {
                    if (process.platform === 'linux') {
                        if (p.startsWith('/'))
                            localPath = p;
                        else if (p.startsWith('~'))
                            localPath = p.replace('~', process.env.HOME);
                    } else
                        localPath = p;
                }
            }
        }
        return localPath;
    }
}

module.exports = FileStorageController;