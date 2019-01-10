const { logger: loggerConfig } = require('./config')
const { createLogger, format, transports } = require('winston')

module.exports = createLogger(
  Object.assign(
    {
      level: 'info',
      defaultMeta: { module: 'peon' },
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
    },
    loggerConfig
  )
)
