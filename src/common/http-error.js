class HttpError extends Error {

    response;

    constructor(message, response) {
        if (!message && response) {
            message = '';
            if (response.status)
                message += response.status + ': ';
            if (response.statusText)
                message += response.statusText;
            if (response.url)
                message += ' - ' + response.url;
        }
        super(message);
        this.name = this.constructor.name;
        this.response = response;
    }
}

module.exports = HttpError;