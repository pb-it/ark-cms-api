### System routes


#### Info

`/sys/info`


#### Log

`/sys/log`

`/sys/log?severity=error&_sort=desc&_format=json`


#### Update

`/sys/update`

`/sys/update?version=latest` or `v=latest` 

`/sys/update?reset=true` or `force=true` executes `git reset --hard`

> Be aware that this will delete all local changes!
> 
> Should only be necessary when an update fails because of a file conflict in the `package.json`

with option `rm=true` also the `node_modules` directory will be deleted and all dependencies new fetched


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


#### Upload (env:development)

`/sys/tools/dev/upload`


### API

`/api/*`

* `/api/:model`
* `/api/:model/:id`

#### model

PUT `/api/_model?v=<version>&forceMigration=true`