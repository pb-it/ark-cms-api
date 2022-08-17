class LogEntry {

    date;
    severity;
    message;
    error;

    constructor(severity, message, error) {
        this.date = new Date();
        this.severity = severity;
        this.message = message;
        this.error = error;
    }

    parse(obj) {
        this.date = new Date(obj['date']);
        this.severity = obj['severity'];
        this.message = obj['message'];
        this.error = obj['error'];
    }

    toString() {
        return this.date.toUTCString() + " [" + this.severity + "] " + this.message;
    }
}

module.exports = LogEntry;