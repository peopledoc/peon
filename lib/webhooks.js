const express = require('express')
const { json } = require('body-parser')
const GithubWebHook = require('express-github-webhook')

const {
  webhooks: { port, secret }
} = require('./config')
const logger = require('./logger')

module.exports = function() {
  // eslint-disable-next-line new-cap
  let webhookHandler = GithubWebHook({ path: '/webhooks', secret })

  let app = express()
  app.use(json())
  app.use(webhookHandler)

  return {
    start() {
      app.listen(port, 'localhost', () =>
        logger.info(`listening on localhost:${port}`, { module: 'webhooks' })
      )
    },

    on(event, callback) {
      webhookHandler.on(event, (repo) => {
        logger.debug(`received ${event} on ${repo}`, { module: 'webhooks' })
        callback(...arguments)
      })
    }
  }
}
