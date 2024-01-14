# ark-cms-api

```bash
git clone https://github.com/pb-it/ark-cms-api
#git clone https://github.com/pb-it/ark-cms-api -b 0.4.0-beta --depth 1

npm install --legacy-peer-deps
#npm update

npm run start
```

> Configuration is done via `server-config.js` and `database-config.js` within the `config` folder.

> If no custom configuration is provided on startup, the application will copy a default one from the templates.


## SSL

> If enabled in `server-config.js`, the application expects certificate information via `cert.pem` and `key.pem` within the `config/ssl` folder.


# Docker

```bash
docker build . -t <image name>

docker run -p 3002:3002 -d <image name>

or with interactive bash

docker run -p 3002:3002 -it <image name> /bin/bash
```


# Test

> Create `tests/config/server-config.js` and `tests/config/database-config.js`

&nbsp;

> **INFO**: By now the automatic tests suffer from the lack of ability to verfiy security features!

> Disable SSL while testing when using a self-signed certificate!

> Disable authentication while testing!

> Extensions test needs a existing `cdn` folder which has to be specified in `tests/config/cdn-config.js`

```bash
npm run test
#npm run test:relations
```