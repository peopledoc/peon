const express = require('express')
const { json } = require('body-parser')
const cors = require('cors')
const GithubWebHook = require('express-github-webhook')

const { lookup, register } = require('../injections')

class WebhookServer {
  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('webhooks')
    }
    return this._logger
  }

  get webhookHandler() {
    if (!this._webhookHandler) {
      let {
        config: {
          webhooks: { secret }
        }
      } = lookup()

      // eslint-disable-next-line new-cap
      this._webhookHandler = GithubWebHook({ path: '/webhooks', secret })
    }
    return this._webhookHandler
  }

  get app() {
    if (!this._app) {
      let { logger, webhookHandler } = this
      let app = express()
      app.use(cors())
      app.use(json())
      app.use(webhookHandler)

      // eslint-disable-next-line no-unused-vars
      app.use((err, req, res, next) => {
        logger.error('unhandled error', { module: 'webhooks' })
        logger.error(err, { module: 'webhooks' })
      })

      this._app = app
    }
    return this._app
  }

  start() {
    return new Promise((resolve, reject) => {
      let { app, logger } = this
      let {
        config: {
          webhooks: { port }
        }
      } = lookup()

      this.server = app.listen(port, 'localhost', (e) => {
        if (e) {
          logger.error('could not start listening', { module: 'webhooks' })
          logger.error(e, { module: 'webhooks' })
          reject(e)
        } else {
          logger.info(`listening on localhost:${port}`, {
            module: 'webhooks'
          })
          resolve()
        }
      })
    })
  }

  stop() {
    return new Promise((resolve, reject) => {
      let { logger, server } = this
      if (server) {
        server.close((e) => {
          if (e) {
            logger.error('could not stop listening', { module: 'webhooks' })
            logger.error(e, { module: 'webhooks' })
            reject(e)
          } else {
            logger.info('stopped listening', { module: 'webhooks' })
            resolve()
          }
        })

        this.server = null
      } else {
        resolve()
      }
    })
  }

  on(event, callback) {
    let { logger, webhookHandler } = this

    webhookHandler.on(event, function(repo) {
      logger.debug(`received ${event} on ${repo}`, { module: 'webhooks' })
      callback(...arguments)
    })
  }
}

register(WebhookServer)
