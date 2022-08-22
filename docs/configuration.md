## Server: /config/server-config.js

Template: `/config/server-config-template.js`


### port

Change to your desired port number.


### processManager

Define when using an process manager which keeps your application running.

> **Explanation**:
>
> When the the application is restarting it gets an new process id.
>
> The process manager detects the termination of the old process and trys to restart the application.
>
> This will fail because the ports are already in use by the newly forked process, of which the process manager is not aware of.
>
> So in case of using an process manager the application should only quit on restart and let the process manager restart it.

Possible values:
* null / undefined
* true / false
* 'pm2' # currently there is no distinction between any given names


## Database: /config/database-config.js

Template: `/config/database-config-template.js`

Edit your DBMS settings and credentials.