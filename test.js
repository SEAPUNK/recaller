import test from 'ava'
import recaller, {
  constantBackoff,
  exponentialBackoff // ,
  // fullJitterBackoff,
  // equalJitterBackoff,
  // decorrelatedJitterBackoff
} from './'

test('function should not be retried if async function is ok', async t => {
  t.plan(1)

  let called = false

  const retval = await recaller(async () => {
    if (called) return t.fail('Called multiple times')
    called = true
    return 50
  })

  t.is(retval, 50)
})

test('function should be retried if async function rejects (next ok)', async t => {
  t.plan(1)

  let called = false

  const retval = await recaller(async () => {
    if (!called) {
      called = true
      throw new Error('uh oh')
    }
    return 50
  })

  t.is(retval, 50)
})

test('function should be retried if async function rejects (all fail)', async t => {
  t.plan(1)

  try {
    await recaller(async () => {
      throw new Error('uh oh')
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'uh oh')
  }
})

test('bailing should work (error provided)', async t => {
  t.plan(2)

  let called = false
  let bailed = false

  try {
    await recaller(async (bail) => {
      if (bailed) t.fail('bailed, but still called')
      if (called) {
        bailed = true
        bail(new Error('bailed!'))
        t.pass()
        return
      }
      called = true
      throw new Error('uh oh')
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'bailed!')
  }
})

test('bailing should work (nothing provided)', async t => {
  t.plan(1)

  try {
    await recaller(async (bail) => {
      bail()
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'Bailed without giving a reason.')
  }
})

test('recaller must require a function', async t => {
  t.plan(1)

  try {
    await recaller()
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fn is not a function')
  }
})

test('retry amounts (default, 10)', async t => {
  t.plan(12)

  try {
    await recaller(async () => {
      t.pass()
      throw new Error('fail')
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('retry amounts (set, 4)', async t => {
  t.plan(6)

  try {
    await recaller(async () => {
      t.pass()
      throw new Error('fail')
    }, {retries: 4})
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('attempt should be a correct number', async t => {
  t.plan(5)

  let currentAttempt = 1

  try {
    await recaller(async (bail, attempt) => {
      t.is(attempt, currentAttempt)
      currentAttempt++
      throw new Error('fail')
    }, {retries: 3})
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('onretry, invalid value', async t => {
  t.plan(1)

  try {
    await recaller(async () => {
      throw new Error('fail')
    }, {onretry: 123})
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'onretry handler is not a function')
  }
})

test('onretry, called (no backoff)', async t => {
  t.plan(31)

  let currentAttempt = 1

  try {
    await recaller(async (bail, attempt) => {
      throw new Error('fail' + attempt)
    }, {onretry: function (err, attempt, delayTime) {
      t.is(err.message, 'fail' + currentAttempt)
      t.is(attempt, currentAttempt)
      t.is(delayTime, 0)
      currentAttempt++
    }})
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fail11')
  }
})

test('onretry, called (backoff)', async t => {
  t.plan(2)

  try {
    await recaller(async () => {
      throw new Error('fail')
    }, {
      onretry: function (err, attempt, delayTime) {
        err // touch so linter doesn't complain
        t.is(delayTime, 200)
      },
      retries: 1,
      backoff: constantBackoff(200)
    })
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('backoff (constant)', async t => {
  t.plan(2)

  let lastDelay

  try {
    await recaller(async () => {
      if (lastDelay) {
        const duration = Date.now() - lastDelay
        t.is((duration > 200 && duration < 500), true)
      }
      lastDelay = Date.now()
      throw new Error('fail')
    }, {
      retries: 1,
      backoff: constantBackoff(200)
    })
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('constantBackoff', t => {
  t.plan(4)

  const cb1 = constantBackoff()
  t.is(cb1(1), 5000)
  t.is(cb1(2), 5000)

  const cb2 = constantBackoff(300)
  t.is(cb2(1), 300)
  t.is(cb2(2), 300)
})

test('exponentialBackoff', t => {
  t.plan(3)

  // default values
  const eb1 = exponentialBackoff()
  t.is(eb1(1), 1000)
  t.is(eb1(2), 2000)
  t.is(eb1(3), 4000)
})

// TODO: Other backoff tests
