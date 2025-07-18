## (Server) Extensions

When the model is loaded the extension is evaluated like code in an regular file.

So you can define functions, classes, etc. which you can afterwards use in your hooks, etc..

This is also the place where you can define new custom routes for your model/application.


### Custom data routes

Example:

```js
const route = {
    'regex': '^/test/(\\d+)$',
    'fn': async function (req, res) {
        const data = {};
        data['message'] = "request for 'test' with id:" + req.locals['match'][1] + " overwritten!";
        res.json(data); // response with your own data
        return Promise.resolve();
    }
};
controller.getWebServer().addCustomDataRoute(route);
```


### Hooks

Hooks are called from the application when it reaches defined states.


#### init hook

Enables asyncronous initialisation of the model.

```js
module.exports.init = async function () {
    ... // install dependencies, setup custom routes, etc.
    return Promise.resolve();
}
```


#### CRUD hooks

There are hooks which are called before and after all CRUD database actions:

* preCreateHook
* postCreateHook
* preReadHook
* postReadHook
* preUpdateHook
* postUpdateHook
* preDeleteHook
* postDeleteHook

Example:

```js
module.exports.preCreateHook = async function (data) {
    ... // manipulate the data here!
    return data;
}
```

## Summarizing example (web scraper / crawler with jsdom)

```js
var jsdom;
try {
    jsdom = require("jsdom");
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND')
        throw e;
}

const { JSDOM } = jsdom || {};

const controller = require("../../src/controller/controller");

/**
 * executed in the context of the model
 */ 
module.exports.init = async function () {
    await controller.getDependencyController().installDependencies(['jsdom']);

    var attributes = this._definition['attributes'];
    var attr = ...
    var path = controller.getFileStorageController().getPathForFile(attr);

    return Promise.resolve();
}

module.exports.preCreateHook = async function (data) {
    
    ... // manipulate the data here!

    // as example by crawling a given website
    const ext = controller.getExtensionController().getExtension('http-proxy');
    const { HttpProxy } = ext['module'];
    var body = HttpProxy.request(data['url']);
    var doc = new JSDOM(body).window.document;
    ...

    var model = controller.getShelf().getModel("test");

    return data;
}
```