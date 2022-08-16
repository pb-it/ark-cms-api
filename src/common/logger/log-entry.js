class LogEntry {

    date;
    severity;
    message

    constructor(severity, message) {
        this.date = new Date().toUTCString();
        this.severity = severity;
        this.message = message;
    }

    parse(obj) {
        this.date = obj['date'];
        this.severity = obj['severity'];
        this.message = obj['message'];
    }

    toString() {
        return this.date + " [" + this.severity + "] " + this.message;
    }
}

module.exports = LogEntry;