# wing-cms-api

```bash
git clone https://github.com/pb-it/wing-cms-api
#git clone https://github.com/pb-it/wing-cms-api -b 0.4.0-beta --depth 1

npm install --legacy-peer-deps

//npm update

npm run start
```


# Docker

```bash
docker build . -t /<image name/>

docker run -p 3002:3002 -d /<image name/>

or with interactive bash

docker run -p 3002:3002 -it /<image name/> /bin/bash
```


# Test

> need a `cdn` folder at same height as the project and `auth: false` in the `server-config.js`

```bash
npm run test
//npm run test-relations
```