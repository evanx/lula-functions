const config = require('config')
const pino = require('pino')
const Redis = require('ioredis')

const redis = new Redis(
  Object.assign({}, config.lula.redis.default, config.lula.redis.monitor),
)

module.exports = ({ source }) => {
  const logger = pino({
    name: [config.lula.monitor.source, source].join('/'),
    level: config.lula.monitor.level,
    base: process.env.LOG_LOCAL === 'true' ? {} : {},
    prettyPrint:
      process.env.LOG_PRETTY === 'true'
        ? {
            colorize: true,
            translateTime: true,
          }
        : false,
  })

  const trace = process.env.TRACE_ERR
    ? (source) => {
        if (source === process.env.TRACE_ERR) {
          throw new Error(`TEST_ERR: ${source}`)
        }
      }
    : process.env.TRACE_LOG
    ? (...args) => console.log('TRACE_LOG', args)
    : () => undefined

  const makeLevel = (level) => {
    return (...args) => {
      if (
        args.length === 2 &&
        typeof args[0] === 'object' &&
        typeof args[1] === 'string'
      ) {
        const xaddParams = [
          'monitor:x',
          'maxlen',
          config.lula.monitor.maxLength,
          '*',
          'source',
          source,
          'level',
          level,
          'data',
          JSON.stringify(args[0]),
          'message',
          args[1],
        ]
        redis.xadd(...xaddParams)
      }
      if (process.env.MONITOR === source || ['warn', 'error'].includes(level)) {
        logger[level](...args)
      }
    }
  }

  return {
    logger,
    debug: makeLevel('debug'),
    info: makeLevel('info'),
    warn: makeLevel('warn'),
    error: makeLevel('error'),
    trace,
  }
}
