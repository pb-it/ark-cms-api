### System routes


#### Info

`/sys/info`


#### Log

`/sys/log`

`/sys/log?severity=error&_sort=desc&_format=json`


#### Update

`/sys/update`

`/sys/update?v=latest?force=true`


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

`/sys/db/backup`

`/sys/db/restore`


#### RUN (env:development)

`/sys/run`


#### EXEC (env:development)

`/sys/exec`


### API

`/api/*`

* `/api/:model`
* `/api/:model/:id`

#### model

PUT `/api/_model?v=<version>&forceMigration=true`