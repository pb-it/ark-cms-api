### System routes


#### Info

`/sys/info`


#### Log

`/sys/log`

`/sys/log?severity=error&_sort=desc&_format=json`


#### Update

`/sys/update`

`/sys/update?version=latest` or `v=latest` 

`/sys/update?reset=true` executes `git reset --hard`

> Be aware that this will delete all local changes!
> 
> Should only be necessary when an update fails because of a file conflict in the `package.json`

with option `rm=true` also the `node_modules` directory will be deleted and all dependencies new fetched

with option `force=true` warnings regarding incompatibilities with an upgrade of minor or major release versions will be ignored


#### Reload models

`/sys/reload`

`/sys/reload?forceMigration=true`


#### Restart

`/sys/restart`


#### Shutdown

`/sys/shutdown`


#### Authentication

`/sys/auth/login`

`/sys/auth/logout`

`/sys/auth/passwd`


#### Database

`/sys/tools/db/backup`

`/sys/tools/db/restore`


#### Eval (env:development)

`/sys/tools/dev/eval`


#### Func (env:development)

`/sys/tools/dev/func`


#### Exec (env:development)

`/sys/tools/dev/exec`


#### Edit (env:development)

`/sys/tools/dev/edit`

Parameters:

* `file=./src/...` (path must be absolute or relative to appRoot)


#### Patch (env:development)

`/sys/tools/dev/patch`

> Patches files inside of appRoot with content of the provided ZIP archive


### API


#### Data

`/api/data/v1/*`

* `/api/data/v1/:model`
* `/api/data/v1/:model/:id`


##### model

PUT `/api/data/v1/_model?v=<version>&forceMigration=true`


#### Extensions

`/api/ext/*`