# Peon

They do all the work (build, CI, deploy) behind closed doors (behind your VPN).

## Configuration

In your repository, add a `.peon.yml` file as the following:

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

# Environment passed to all build commands
# $PEON_ROOT_URL and $PEON_BRANCH are replaced when building
environment:
  ROOT_URL: "$PEON_ROOT_URL"
```

# License

© 2019 Nicolas Joyard, Xavier Cambar for PeopleDoc
