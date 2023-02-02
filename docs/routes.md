### System routes


#### Info

`http://localhost:3002/sys/info`


#### Log

`http://localhost:3002/sys/log`

`http://localhost:3002/sys/log?severity=error&_sort=desc&_format=json`


#### Update

`http://localhost:3002/sys/update`

`http://localhost:3002/sys/update?v=latest?force=true`


#### Reload models

`http://localhost:3002/sys/reload`

`http://localhost:3002/sys/reload?forceMigration=true`


#### Restart

`http://localhost:3002/sys/restart`


#### Shutdown

`http://localhost:3002/sys/shutdown`


#### Authentication

`http://localhost:3002/sys/auth/login`

`http://localhost:3002/sys/auth/logout`


### API

`http://localhost:3002/api/*`

PUT `http://localhost:3002/api/_model?v=<version>&forceMigration=true`