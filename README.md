# Peon

> They do all the work behind closed doors.

Peon is a minimal CD tool that can be used to run build commands on git
repositories and deploy built artifacts locally. The main goal is to
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
  - `dbBackupInterval`: database backup interval in milliseconds, defaults to
    no backups.
  - `dbBackupKeep`: number of previous backups to keep, defaults to keeping all.
  - `cacheValidity`: validity in milliseconds of paths cached during builds.
  - `cacheMaxSize`: maximum size of cache in bytes; peon will remove the oldest
    non-expired cache items until cache size is below that limit. Set to 0 for
    unlimited cache size.
  - `statusDirectory`: a directory where peon will store its status pages.
  - `statusUrl`: URL where the status directory is served (used for github
    build status updates)
  - `indexBuildCount`: maximum number of builds to show on status index page,
    defaults to all builds
  - `githubAPIToken`: a GitHub API token used to update build status on commits.

- **Watcher configuration:** enable this when you want peon to poll git
  repositories at regular intervals (useful when the machine is not reachable
  from the internet and thus cannot receive webhooks)

  - `watcher.enabled`: boolean, enables or disables repository watchers
  - `watcher.interval`: interval in milliseconds between polls on each
    repository
  - `watcher.repositories`: an array of objects for each repository to watch
    - `watcher.repositories[].url`: url to the repository (http(s), git, ssh)
    - `watcher.repositories[].branches`: list of branches to watch for changes.

- **Webhooks configuration:** enable this when the machine is reachable from the
  internet to listen for Github webhooks

  - `webhooks.enabled`: boolean, enables or disables listening for webhooks
  - `webhooks.port`: port to listen on; Peon will only listen on localhost so
    you must have a web server running that proxies webhook requests received
    on the public endpoint to this port.
  - `webhooks.secret`: set it to something secret that you will configure on
    your repositories on Github.

- **Build output destinations configuration:** configure destinations where Peon
  will store build outputs (using rsync). Destinations can be local or remote.

  - `destinations.$name.destination`: local or remote path specification, for
    example `/var/www/peon` or `[user@]host:/path/to/directory`. The directory
    must exist.
  - `destinations.$name.rootUrl`: root URL path the destination is served by a
    webserver (without the protocol/host/port).
  - `destinations.$name.absoluteUrl`: full URL the destination is served by a
    webserver (**with** protocol/host/port). This is used so that peon can
    generate links to the deployed build.
  - `destinations.$name.shell`: used only for remote destinations; shell command
    to use to connect to the remote. You can use it to pass SSH options (for
    example `ssh -o StrictHostKeyChecking=no -i /path/to/id_rsa`). Note that
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

Run `node ./index.js` from the repostory root. You may want to use some
kind of process manager (forever, pm2, systemd...) to keep it running.

## Repository configuration

Peon will only run builds when it finds a `.peon.yml` file at the root of a
repository. A reference of available options follows.

### `branches` (optional) - branches allowed to build

By default Peon triggers builds on all branches. To restrict branches that can
trigger a build, you can specify them as a list of regexps.

```yaml
branches:
  - ^master$
  - ^feat/
```

### `cache` (optional) - build assets caching

Peon allows storing build assets in cache after a build an restoring them before
a subsequent build. This is useful for example when one of the building steps
downloads dependencies based on a requirements file (eg. npm, yarn, pip) and you
don't want the whole process of downloading all the dependencies to run again
when your project hasn't changed.

You can specify a list of paths to store, along with a file whose contents will
be used to determine the validity of the cache.

```yaml
cache:
  - path: node_modules
    source: yarn.lock
```

### `commands` (mandatory) - commands to run when building.

Those commands will be run in sequence from the repository root.

```yaml
commands:
  - yarn
  - yarn build -prod
```

The following environment variables are available to those commands:

- `$PEON_BUILD_ID`: ID of the build (eg. "reponame#123")
- `$PEON_BUILD_DATE`: ISO-formatted timestamp of the build start date
- `$PEON_REPO_NAME`: name of the repository being built
- `$PEON_BRANCH`: branch being built if building a branch
- `$PEON_TAG`: tag being built if building a tag
- `$PEON_REF`: equivalent to `$PEON_BRANCH` or `$PEON_TAG`
- `$PEON_COMMIT`: commit SHA1 being built
- `$PEON_ROOT_URL`: root URL where the build will be served,

Additional environment variables may be specified in the repository
configuration file, see `environment` below.

### `destinations` (mandatory) - where to deploy the build output

Peon configuration file allows defining a list of named destinations to deploy
build outputs, both local (on the machine where Peon is running) and remote
(using rsync). From the perspective of your project however, there is no
difference between local and remote destinations.

The `destinations` key in the repository configuration file specifies which
destination(s) you want to use when deploying your project and which branches or
tags they apply to. Peon will use the first matching destination, and will
abort the build when no destination matches.

```yaml
destinations:
  # Deploy master to production at a fixed path
  - name: production
    branch: ^master$
    path: documentation/myproject/master
  # Deploy tags vX.Y.Z to production at a variable path
  - name: production
    tag: ^v\d
    path: documentation/myproject/$PEON_TAG
  # This rule is equivalent to both rules above
  - name: production
    branch: ^master$
    tag: ^v\d
    path: documentation/myproject/$PEON_REF
  # Deploy everything else to local in REPONAME/REF
  - name: local
```

Each destination you specify has the following keys:

- `name`: mandatory; name of a destination defined in Peon configuration file
- `path`: optional; path relative to the destination to store the build into.
  If not specified, defaults to `$PEON_REPO_NAME/$PEON_REF`. You can use peon
  environment variables in the value.
- `branch`: optional, ignored when building a tag; regexp checked against the
  branch being built. If not specified, defaults to matching all branches,
  unless a tag regexp is also specified in which case it defaults to _not_
  matching any branch.
- `tag`: optional, ignored when building a branch; regexp checked against the
  tag being built, defaults to _not_ matching any tag.

To summarize the destination choice process:

- When building a branch, Peon will chose the first destination that either has
  a matching `branch` regexp or has neither a `branch` nor a `tag` regexp.
- When building a tag, Peon will chose the first destination that explicitly
  defines a matching `tag` regexp.

### `environment` (optional) - additional build environment variables

You can specify additional environment variables that will be made available to
all build commands. Values can include Peon environment variables.

```yaml
environment:
  MYVARIABLE: myvalue
  MYROOTURL: "$PEON_ROOT_URL/myapp/"
```

### `output` (mandatory) - where to find the build output

This should be the name of a directory relative to the repository root where
Peon can find the build output. Its contents will be copied into the directory
specified in the `destinations` configuration.

```yaml
output: dist
```

### `tags` (optional) - tags allowed to build

By default Peon does not trigger any build on tags. If you want to trigger
builds when pushing tags, you can specify a list of tag regexps.

```yaml
tags:
  - ^v\d+\.\d+\.\d+$
```

_Note:_ you can only trigger builds on tags from webhooks, not from the watcher.

# Copyright

© 2019 Nicolas Joyard, Xavier Cambar for PeopleDoc
