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
- a web server configured to serve static files from a directory
- when using webhooks, a web server that is able to proxy requests on a
  publicly-accessible URL to a locally-running http server

### Installation

Clone the repository and run `yarn` at the repository root.

### Peon configuration

You can set the `PEON_CONFIG` environment variable to tell Peon where to
look for its configuration file; by default it loads `config.json` at the
root of the repository.

A sample config file is available at the root of the project. See
`config.sample.json` for details.

The configuration file contains the following keys:

- **Base configuration:**
  - `workingDirectory`: a directory where peon stores its working data
  - `cacheValidity`: validity in milliseconds of paths cached during builds.
  - `statusDirectory`: a directory where peon will store its status pages.
  - `statusUrl`: URL where the status directory is served (used for github
    build status updates)
  - `githubAPIToken`: a GitHub API token used to update build status on commits.
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
  - `webhooks.port`: port to listen on; Peon will only listen on localhost so
    you must have a web server running that proxies webhook requests received
    on the public endpoint to this port.
  - `webhooks.secret`: set it to something secret that you will configure on
    your repositories on Github.
- **Build output destinations configuration:** configure destinations where Peon
  will store build outputs (using rsync).  Destinations can be local or remote.
  - `destinations.$name.destination`: local or remote path specification, for
    example `/var/www/peon` or `[user@]host:/path/to/directory`.  The directory
    must exist.
  - `destinations.$name.rootUrl`: root URL path  the destination is served by a
    webserver (without the protocol/host/port).
  - `destinations.$name.absoluteUrl`: full URL the destination is served by a
    webserver (**with** protocol/host/port).  This is used so that peon can
    generate links to the deployed build.
  - `destinations.$name.shell`: used only for remote destinations; shell command
    to use to connect to the remote.  You can use it to pass SSH options (for
    example `ssh -o StrictHostKeyChecking=no -i /path/to/id_rsa`).  Note that
    the command will run as the same user Peon is running as.
- **Git auth configuration:** set up which auth method to use to clone private
  repositories
  - `git.authMethod`: `agent` to use the SSH agent for the user running Peon,
    `key` to use a PEM-format key pair
  - `git.privateKey`: path to the private key to use
  - `git.publicKey`: path to the public key to use
  - `git.keyPassword`: password for the key, use an empty string for unencrypted
    keys
- **Logger configuration:**
  - `logger.level`: one of `error`, `info`, `debug`.

**Notes:**
- The user running peon must have writing rights on `workingDirectory` and
  `statusDirectory`.
- Do not watch a repository that also emits webhooks, it will conflict.

### Running Peon

Run `node ./index.js` from the repostory root.  You may want to use some
kind of process manager (forever, pm2, systemd...) to keep it running.

## Repository configuration

Peon will only run builds when it finds a `.peon.yml` file at the root of a
repository.  This file must have the following content:

```yaml
## Mandatory configuration

# List of commands to run in series to build the app.
# All commands will run with the following environment variables, in addition
# to those defined in this configuration file (see 'environment' below):
# - $PEON_BUILD_ID: ID of the build (eg. "reponame#123")
# - $PEON_BUILD_DATE: ISO-formatted timestamp of the build start date
# - $PEON_BRANCH: branch being built
# - $PEON_COMMIT: commit SHA1 being built
# - $PEON_ROOT_URL: root URL where the build will be served,
#   eg. "${destination rootURL}/reponame/branch"
commands:
  - yarn
  - yarn build -prod

# Build output directory path relative to the repository root; its content will
# be copied to outputDirectory/REPONAME/BRANCH after a successful build.
output: dist

# Destinations for build output, each destination has the following keys:
# - name: mandatory, name of a destination defined in peon configuration
# - branch: optional, regexp checked against the branch being built, defaults to
#   matching all branches
# - path: optional, relative path to store the build into in the destination;
#   defaults to `REPONAME/BRANCH`. May contain a $branch token.
#
# Peon will use the first matching destination
destinations:
  # Deploy master to production at a fixed path
  - name: production
    branch: ^master$
    path: documentation/myproject/master
  # Deploy everything else to local in REPONAME/BRANCH
  - name: local


## Optional configuration

# List of paths to store in cache after build/restore before build relative to
# the repository root.  The 'source' key indicates a file whose fingerprint will
# be used as a key for the cache
cache:
  - path: node_modules
    source: yarn.lock

# By default Peon will run builds on any branch with a .peon.yml file, use this
# to restrict builds to specific branches.
branches:
  - master
  - develop

# Custom environment variables passed to all build commands (optional)
# You can use Peon environment variables in values.
environment:
  MYVARIABLE: myvalue
  MYROOTURL: "$PEON_ROOT_URL/myapp/"
```

# License

© 2019 Nicolas Joyard, Xavier Cambar for PeopleDoc
