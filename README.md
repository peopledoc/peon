# Peon

> They do all the work behind closed doors.

Peon is a minimal CD tool that can be used to run build commands on git
repositories and deploy built artifacts locally.  The main goal is to
allow continuous deployment of static apps.

It can receive Github webhooks, but when deployed on a machine that is not
reachable from the internet, can also watch git repositories directly.

## Usage

### Prerequisites

- node 11+ and yarn
- a web server serving static files from a directory
- when using webhooks, a web server that is able to proxy requests on a
  publicly-accessible URL to a locally-running http server

### Installation

Clone the repository and run `yarn` at the repository root.

### Peon configuration

You can set the `PEON_CONFIG` environment variable to tell peon where to
look for its configuration file; by default it loads `config.json` at the
root of the repository.

The configuration file contains the following keys:

- **Base configuration:**
  - `workingDirectory`: a directory where peon stores its working data
  - `publicDirectory`: a directory where peon will store the build output.
    Peon will create `REPONAME/BRANCHNAME` subdirectories for each build.
  - `rootURLBase`: the URL where the web server serves `publicDirectory`.
- **Watcher configuration:** enable this when you want peon to poll git
  repositories at regular intervals (useful when the machine is not reachable
  from the internet and thus cannot receive webhooks)
  - `watcher.enabled`: boolean, enables or disables repository watchers
  - `watcher.interval`: interval in milliseconds between polls on each
    repository
  - `watcher.repositories`: an array of objects for each repository to watch.
    Each object must contain an `url` key to the repository (http(s), git, ssh)
    a `branches` key that is a list of branches to watch for changes.
- **Webhooks configuration:** enable this when the machine is reachable from the
  internet to listen for Github webhooks
  - `webhooks.enabled`: boolean, enables or disables listening for webhooks
  - `webhooks.port`: port to listen on; peon will only listen on localhost so
    you must have a web server running that proxies webhook requests received
    on the public endpoint to this port.
  - `webhooks.secret`: set it to something secret that you will configure on
    your repositories on Github.
- **Git auth configuration:** set up which auth method to use to clone private
  repositories
  - `git.authMethod`: `agent` to use the SSH agent for the user running peon,
    `key` to use a PEM-format key pair
  - `git.privateKey`: path to the private key to use
  - `git.publicKey`: path to the public key to use
  - `git.keyPassword`: password for the key, use an empty string for unencrypted
    keys
- **Logger configuration:**
  - `logger.level`: one of `error`, `info`, `debug`.

**Notes:**
- The user running peon must have writing rights on `workingDirectory` and
  `publicDirectory`.
- Do not watch a repository that also emits webhooks, it will conflict.

### Running peon

Run `node ./index.js` from the repostory root.  You may want to use some
kind of process manager (forever, pm2, systemd...) to keep it running.

## Repository configuration

Peon will only run builds when it finds a `.peon.yml` file at the root of a
repository.  This file must have the following content:

```yaml
# List of branches where a build is allowed (optional, defaults to allowing all branches)
branches:
  - master
  - develop

# List of commands to run in series to build the app
commands:
  - yarn
  - yarn build -prod

# Where peon can find the result of the build after running build commands
output: ./dist

# Environment passed to all build commands (optional)
# $PEON_ROOT_URL and $PEON_BRANCH are replaced when building
environment:
  ROOT_URL: "$PEON_ROOT_URL"
```

# License

© 2019 Nicolas Joyard, Xavier Cambar for PeopleDoc
