<div align="center">
  <a href="https://github.com/flolu/angular-bazel-starter">
    <img width="180px" height="auto" src="./services/client/assets/icons/icon-192x192.png" />
  </a>
  <br>
  <h1>Angular Bazel Starter</h1>
  <p>
    Full stack starter Monorepo for building modern web apps with <a href="https://angular.io/">Angular</a> and <a href="https://bazel.build/">Bazel</a>
  </p>
</div>

# Features

- Development server with hot reload
- Lazy Loading
- Progressive Web App
- Service Worker
- Server Side Rendering
- Sass for styling
- Environments
- Shared libraries
- Perfect Lighthouse score
- Realtime messages from server with Web Sockets
- NgRx for state management
- Push Notifications

# Requirements

- Linux
- Bazel <!-- TODO check if actually needed, maybe bazelisk is enough -->
- Yarn
- Docker Compose
- Kubectl

# Commands

**Setup**

```bash
# Install dependencies
yarn && \

# Create secrets for cevelopment
cp libs/config/secrets/dev.secrets-example.json libs/config/secrets/dev.secrets.json && \

# Create secrets for production
cp libs/config/secrets/prod.secrets-example.json libs/config/secrets/prod.secrets.json
```

**Development**

- Start client: `yarn dev`
- Start server: `yarn server:dev`

**Production**

- Start client: `yarn ssr`
- Start backend: `yarn server`

# TODO

- Deployment to Kubernetes
- Configuration and Secret management for different environments
- Docker compose to start dev backend
- Differential Loading
- Unit Tests
- Integration Tests
- Documentation

## Thanks to all the people listed below!

[@rayman1104](https://github.com/rayman1104) [@marcus-sa](https://github.com/marcus-sa) [@joeljeske](https://github.com/joeljeske)

<!--
# TODO upgrade ngrx to v10... currently causes errors
-->
