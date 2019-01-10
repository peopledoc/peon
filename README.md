# Peon

They do all the work (build, CI, deploy) behind closed doors (behind your VPN).

## Configuration

In your repository, add a `.peon.yml` file as the following:

```yaml
---

requirements:
  - yarn

output: ./dist

environment:
  ROOT_URL: "$PEON_ROOT_URL"

commands:
  - yarn
  - yarn build -prod
```

# License

© 2019 Nicolas Joyard, Xavier Cambar for PeopleDoc
