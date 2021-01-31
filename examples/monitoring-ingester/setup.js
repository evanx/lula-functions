module.exports = async ({ lula, config, monitor, redis }) => {
  monitor.info({
    redisTime: await redis.time(),
  })

  return {
    error: async (err) => {
      monitor.info({ err }, 'error')
    },
  }
}
