const config = require('config')
const pino = require('pino')

// should support warn() for shutdown errors possibly after `
module.exports = ({ name }) =>
  pino({
    name,
    level: config.lula.logger.level,
    base: process.env.LOG_LOCAL === 'true' ? {} : {},
    prettyPrint:
      process.env.LOG_PRETTY === 'true'
        ? {
            colorize: true,
            translateTime: true,
          }
        : false,
  })
