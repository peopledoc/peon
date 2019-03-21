const { format, transports, loggers } = require('winston')
const { register, lookup } = require('../injections')

const knownLoggers = []

register('getLogger', function getLogger(category) {
  let {
    config: { logger: loggerConfig }
  } = lookup()

  let level = loggerConfig
    ? loggerConfig[category] || loggerConfig.level || 'info'
    : 'info'

  if (knownLoggers.indexOf(category) == -1) {
    knownLoggers.push(category)
    loggers.add(
      category,
      Object.assign({
        level,
        defaultMeta: { module: category },
        format: format.combine(
          format.colorize(),
          format.timestamp(),
          format.printf((info) => {
            return `${info.timestamp} [${info.module}] ${info.level}: ${
              info.message
            }`
          })
        ),
        transports: [new transports.Console()]
      })
    )
  }

  return loggers.get(category)
})
