const { format, transports, loggers } = require('winston')

const { logger: loggerConfig } = require('../config')

const knownLoggers = []

module.exports = function getLogger(category) {
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
}
