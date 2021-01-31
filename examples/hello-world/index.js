module.exports = {
  spec: {
    name: 'hello-world',
  },
  config: { audienceLabel: 'world' },
  setup: async ({ config, monitor, redis }) => {
    monitor.info(
      { redisTime: await redis.time() },
      `hello ${config.audienceLabel}`,
    )
    return {
      getAudienceLabel: async () => config.audienceLabel,
    }
  },
}
