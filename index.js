require('./lib/lula')({
  services: [
    [{}, require('./examples/monitoring-ingester')],
    [{}, require('./examples/hello-world')],
    [
      {
        lula: {
          loop: {
            delay: '500',
          },
        },
        audienceLabel: 'wide world',
      },
      require('./examples/hello-wide-world'),
    ],
  ],
})
