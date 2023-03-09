### System routes


#### Info

`/sys/info`


#### Log

`/sys/log`

`/sys/log?severity=error&_sort=desc&_format=json`


#### Update

`/sys/update`

`/sys/update?version=latest` or `v=latest` 

`/sys/update?force=true` executes `git reset --hard` and deletes `node_modules` directory

> Be aware that this will delete all local changes!
> 
> Should only be necessary when an update fails because of a file conflict in the `package.json`

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


#### Upload (env:development)

`/sys/tools/dev/upload`


### API

`/api/*`

* `/api/:model`
* `/api/:model/:id`

#### model

PUT `/api/_model?v=<version>&forceMigration=true`