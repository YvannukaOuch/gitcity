# GitCity

Turn anyone's GitHub into a tiny floating city. Every repo is a building, as tall as the repo is big.

**Live:** https://gitcity.sraas.dev

## Run it

```sh
npm install
npm run dev
```

Built with React, TypeScript, three.js and shadcn/ui. GitHub's API is called straight from the browser, so there is no backend.

`./deploy.sh` builds it and publishes the static files to the VPS.
