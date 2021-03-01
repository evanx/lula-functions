const assert = require('assert')
const config = require('config')
const Redis = require('ioredis')
const { v4: uuidv4 } = require('uuid')
const { multiAsync, delay } = require('./utils')
const makeMonitor = require('./monitor')

const makeRedis = (options = {}) =>
  new Redis(Object.assign({}, config.lula.redis.default, options))

const parseIntStrict = (string) => {
  if (typeof string !== 'string') {
    throw new Error(`parseInt: ${string} with type ${typeof string}`)
  }
  const value = parseInt(string)
  if (string === String(value)) {
    return value
  } else {
    throw new Error(`parseInt: '${string}' to ${value}`)
  }
}

module.exports = async ({ services }) => {
  const serviceInstances = {}
  const redis = makeRedis(config.lula.redis.lula)
  const lulaInstance = {
    id: await redis.incr('instance:i'),
  }
  const monitor = makeMonitor({ source: 'core' })

  const closeLula = async (value) => {
    try {
      let errorCode = value.error ? value.error.code || 'uncoded' : 'ok'
      const commands = [
        ['srem', 'lula:active:s', String(process.pid)],
        ['zincrby', 'lula:counters:z', 1, 'close'],
        ['zincrby', 'lula:error:counters:z', 1, errorCode],
      ]
      monitor.info({ commands }, 'closeLula')
      await multiAsync(redis, commands)
    } catch (err) {
      monitor.warn({ err }, 'closeLula')
    }
    if (redis) {
      await redis.quit()
    }
  }

  const finish = async (error) => {
    for (let [serviceKey, serviceInstance] of Object.entries(
      serviceInstances,
    )) {
      if (serviceInstance.methods.finish) {
        monitor.info({ serviceKey }, 'finish')
        try {
          await serviceInstance.methods.finish(error)
        } catch (err) {
          monitor.warn({ err, serviceKey }, 'finish')
        }
      }
    }
    if (error) {
      await closeLula({
        error: {
          message: error.message,
          code: error.code,
        },
      })
    } else {
      await closeLula({})
    }
  }

  const exit = async (message, err) => {
    if (err) {
      monitor.error({ err }, `Exit app: ${message}`)
      await finish(err)
      process.exit(1)
    } else {
      monitor.error({ err }, `Exit app: ${message}`)
      await finish(null)
      process.exit(0)
    }
  }

  process.on('unhandledRejection', (err) => {
    exit('unhandledRejection', err)
  })

  process.on('uncaughtException', (err) => {
    exit('uncaughtException', err)
  })

  const connectServiceInstance = (serviceKey, serviceInstance) => {
    monitor.trace(`connectServiceInstance:${serviceKey}`)

    if (serviceInstance.spec.peers) {
      Object.entries(serviceInstance.spec.peers).map(([peerKey, peerInfo]) => {
        if (peerInfo.serviceKey) {
          const peerInstance = serviceInstances[peerInfo.serviceKey]
          assert(peerInstance, `peer: ${peerInfo.serviceKey}`)
          serviceInstance.lula[peerKey] = peerInstance.methods
        }
      })
    }
  }

  const setupService = async (serviceConfig, service) => {
    const serviceKey = service.spec.name
    assert(serviceKey, 'service.spec.name')
    monitor.trace(`setupService:${serviceKey}`)

    const serviceInstance = {
      serviceKey,
      spec: service.spec,
      monitor: makeMonitor({
        source: serviceKey,
      }),
      config: Object.assign({}, config, service.spec.config, serviceConfig),
      counters: {
        loop: 0,
      },
      timers: {
        setup: Date.now(),
      },
      redis: makeRedis(),
      blockingRedis: makeRedis(),
      utils: require('./utils'),
      lulaInstanceId: lulaInstance.id,
      lula: {},
      exit,
    }

    serviceInstance.parsedConfig = {
      lula: {
        loop: {
          delay: parseIntStrict(serviceInstance.config.lula.loop.delay),
        },
      },
    }

    if (service.spec.peers) {
      Object.entries(service.spec.peers).map(([peerKey, peerInfo]) => {
        if (peerInfo.serviceKey) {
          const peerInstance = serviceInstances[peerInfo.serviceKey]
          if (peerInstance) {
            serviceInstance.lula[peerKey] = peerInstance.methods
          }
        }
      })
    }

    serviceInstance.methods = await service.setup(serviceInstance)
    monitor.info(
      {
        serviceKey: serviceInstance.serviceKey,
        methods: Object.keys(serviceInstance.methods),
      },
      'setup',
    )
    serviceInstance.runner = async () => {
      if (process.env.TEST_ERR === `start:service:${serviceKey}`) {
        throw new Error(`TEST_ERR: ${process.env.TEST_ERR}`)
      }
      if (serviceInstance.methods.test && serviceInstance.methods.test.setup) {
        await serviceInstance.methods.test.setup()
      }
      if (serviceInstance.methods.start) {
        await serviceInstance.methods.start()
      }
      if (serviceInstance.methods.loop || serviceInstance.methods.inputStream) {
        const delayMs = serviceInstance.parsedConfig.lula.loop.delay
        while (!lulaInstance.closed) {
          if (serviceInstance.methods.loop) {
            if (process.env.TEST_ERR === `loop:service:${serviceKey}`) {
              throw new Error(`TEST_ERR: ${process.env.TEST_ERR}`)
            }
            serviceInstance.counters.loop++
            await serviceInstance.methods.loop()
          }
          if (serviceInstance.methods.inputStream) {
            await serviceInstance.methods.inputStream()
          }
          await delay(serviceInstance.parsedConfig.lula.loop.delay)
        }
      }
    }

    return serviceInstance
  }

  const [restartCount] = await multiAsync(redis, [
    ['hincrby', 'lula:counter:h', 'restart', 1],
    ['sadd', 'lula:active:s', String(process.pid)],
  ])

  setInterval(async () => {
    const exists = await redis.sismember('lula:active:s', String(process.pid))
    if (!exists) {
    }
  }, config.lula.activeIntervalMs)

  if (config.http && config.http.disabled != 'true') {
    httpServer.listen(parseInt(config.http.port), () => {
      monitor.info(`HTTP server listening on port ${config.http.port}`)
    })
  }

  monitor.info({ restartCount, config, pid: process.pid }, 'Lula ready')
  for (const tuple of services) {
    const serviceInstance = await setupService(...tuple)
    serviceInstances[serviceInstance.serviceKey] = serviceInstance
  }
  const serviceKeys = Object.keys(serviceInstances)
  monitor.info({ serviceKeys }, 'Services setup')
  for (const tuple of Object.entries(serviceInstances)) {
    connectServiceInstance(...tuple)
  }
  await Promise.all(
    Object.values(serviceInstances).map((serviceInstance) =>
      serviceInstance.runner(),
    ),
  )
  throw new Error('Runners resolved')
}
