module.exports = async ({
  config,
  serviceKey,
  lulaInstanceId,
  utils,
  monitor,
  redis,
}) => {
  const { multiAsync, reduceRedisFields } = utils
  monitor.info({
    redisTime: await redis.time(),
  })

  const counters = {
    processed: 0,
    types: {},
    sources: {},
  }

  const getAggregationPeriods = (leafPeriod) => [
    leafPeriod,
    leafPeriod.substring(0, 13),
    leafPeriod.substring(0, 10),
    leafPeriod.substring(0, 7),
    leafPeriod.substring(0, 4),
    'all',
  ]

  const splitCategory = (category) => {
    const index = category.indexOf('/')
    return index >= 0
      ? [category, category.substring(0, index), 'all']
      : [category, 'all']
  }

  const getAggregationKeys = (source, level) =>
    splitCategory(source).flatMap((sourceCategory) =>
      splitCategory(level).map((levelCategory) =>
        [sourceCategory, levelCategory].join('^'),
      ),
    )

  return {
    test: {
      setup: async () => {
        const groupsRes = await redis.xinfo('groups', 'monitor:x')
        const groupNames = groupsRes
          .map((group) => reduceRedisFields(group, ['name']))
          .map((group) => group.name)
        if (!groupNames.includes(serviceKey)) {
          await redis.xgroup(
            'create',
            'monitor:x',
            serviceKey,
            '0-0',
            'mkstream',
          )
        }
      },
    },
    error: async (err) => {
      monitor.info({ err }, 'error')
    },
    loop: async () => {
      const [leafPeriod, ingestedScore] = await redis.zrange(
        'mi:ingested:z',
        0,
        0,
        'withscores',
      )
      if (!leafPeriod) {
        return
      }
      const aggregationTime = parseInt(ingestedScore) + config.aggregationLagMs
      if (aggregationTime < Date.now()) {
        return
      }
      const sumKeys = await redis.smembers(`mi:${leafPeriod}:sum:s`)
      if (!sumKeys) {
        return
      }
      const factKeys = ['source', 'level']
      monitor.info({ leafPeriod, ingestedScore, sumKeys }, 'loop period')
      const aggregationPeriods = getAggregationPeriods(leafPeriod)
      const commands = sumKeys
        .flatMap((sumKey) =>
          factKeys.flatMap((factKey) =>
            aggregationPeriods
              .flatMap((aggregationPeriod) => [
                [
                  'zunionstore',
                  `ma:${aggregationPeriod}^${sumKey}:${factKey}:z`,
                  '1',
                  `mi:${leafPeriod}^${sumKey}:${factKey}:z`,
                ],
              ])
              .concat([['del', `mi:${leafPeriod}^${sumKey}:${factKey}:z`]]),
          ),
        )
        .concat([['del', `mi:${leafPeriod}:sum:s`]])
      await multiAsync(redis, commands)
      monitor.info({ leafPeriod, counters }, 'loop')
    },
    inputStream: async () => {
      const res = await redis.xreadgroup(
        'group',
        serviceKey,
        lulaInstanceId,
        'count',
        config.lula.inputStream.xreadgroupCount,
        'streams',
        'monitor:x',
        '>',
      )
      const entries = res[0][1]
      const commands = entries.flatMap(([id, fields]) => {
        const entry = reduceRedisFields(fields)
        const time = parseInt(id)
        const leafPeriod = new Date(time)
          .toISOString()
          .slice(0, 16)
          .replace(/:/, 'h')
        monitor.logger.debug(
          { id, leafPeriod, source: entry.source, type: entry.level },
          'Ingesting stream',
        )
        counters.processed++
        if (!counters.types[entry.level]) {
          counters.types[entry.level] = 1
        } else {
          counters.types[entry.level]++
        }
        const source = 'lf/' + entry.source
        if (!counters.sources[source]) {
          counters.sources[source] = 1
        } else {
          counters.sources[source]++
        }
        const incrementFacts = { source, level: entry.level }
        const sumKeys = getAggregationKeys(source, entry.level)
        return [
          ['zadd', 'mi:ingested:z', Date.now(), String(leafPeriod)],
          ...sumKeys.flatMap((sumKey) => [
            ['sadd', `mi:${leafPeriod}:sum:s`, sumKey],
            ...Object.entries(incrementFacts)
              .filter(([_, value]) => !sumKey.includes('^' + value))
              .map(([key, value]) => [
                'zincrby',
                `mi:${leafPeriod}^${sumKey}:${key}:z`,
                1,
                value,
              ]),
          ]),
        ]
      })
      monitor.logger.debug(`inputStream commands[${commands.length}]`)
      await multiAsync(redis, commands)
    },
  }
}
