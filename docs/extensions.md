## (Server) Extensions

When the model is loaded the extension is evaluated like code in an regular file.

So you can define functions, classes, etc. which you can afterwards use in your hooks, etc..

This is also the place where you can define new custom routes for your model/application.


### Custom (server) routes

Example:

```js
var route = {
    'regex': '^/test/(\\d+)$',
    'fn': async function (req, res) {
        var data = {};
        data['message'] = "request for 'test' with id:" + req.locals['match'][1] + " overwritten!";
        res.json(data); // response with your own data
        return Promise.resolve();
    }
};
controller.addRoute(route);
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