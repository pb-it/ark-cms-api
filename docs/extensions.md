## Extensions

When the model is loaded the extension is evaluated like code in an regular file.

So you can define functions, classes, etc.

This is also the place where you can define new custom routes for your model/application.


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