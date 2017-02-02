recaller
===

[![Greenkeeper badge](https://badges.greenkeeper.io/SEAPUNK/recaller.svg)](https://greenkeeper.io/)

[![npm version](https://img.shields.io/npm/v/recaller.svg?style=flat-square)](https://npmjs.com/package/recaller)
[![javascript standard style](https://img.shields.io/badge/code%20style-standard-blue.svg?style=flat-square)](http://standardjs.com/)
[![travis build](https://img.shields.io/travis/SEAPUNK/recaller/master.svg?style=flat-square)](https://travis-ci.org/SEAPUNK/recaller)
[![coveralls coverage](https://img.shields.io/coveralls/SEAPUNK/recaller.svg?style=flat-square)](https://coveralls.io/github/SEAPUNK/recaller)
[![david dependencies](https://david-dm.org/SEAPUNK/recaller.svg?style=flat-square)](https://david-dm.org/SEAPUNK/recaller)
[![david dev dependencies](https://david-dm.org/SEAPUNK/recaller/dev-status.svg?style=flat-square)](https://david-dm.org/SEAPUNK/recaller)


Promise-based function retry utility. Designed for `async/await`.

**Requires node v4 or above**

`npm install recaller`

- [usage](#usage)
- [api](#api)
- [backoffs](#backoffs)
- [handling retries](#handling-retries)

---

usage
---

*example partially stolen from [async-retry](https://github.com/zeit/async-retry)'s example*

```js
import recaller from 'recaller'
import fetch from 'node-fetch'

export default async function fetchSomething () {
  return await recaller(async (bail, attempt) => {
    const res = await fetch('https://google.com')

    if (403 === res.status) {
      // we're not going to retry
      return bail(new Error('Unauthorized'))
    }

    const data = await res.text()
    return data.substr(0, 500)
  }, {retries: 5})
}
```


api
---

`recaller(fn, opts)`

Calls provided (async or regular) function, and retries on failure.

`fn` is called with two arguments:
- `bail(err)` Stops and rejects the retryer's promise with given error.
    + Note that this does not stop execution, so you have to return manually, allowing you to do some cleanup before returning
- `attempt` Current attempt. First call to function = attempt 1.

`opts` is an object, with the following properties:

- `opts.retries` (default `10`) How many times to retry before giving up, and rejecting with the error.
- `opts.backoff` (default `null`) Backoff generator to use. If null, there is no backoff, and on fail, the function is retried immediately. See: [backoffs](#backoffs)
- `opts.onretry` (default `null`) Retry event handler. See: [handling retries](#handling-retries)

backoffs
---

`recaller` doesn't backoff (wait before retrying) by default. To specify backoff, you must give it a "backoff generator" in the options (`opts.backoff`).

example:

```js
import recaller, {constantBackoff} from 'recaller'

export default function doSomething () {
  return await recaller(async () => {
    const res = await fetch('https://google.com')
  }, {
    // on every failure, wait 5 seconds before retrying
    backoff: constantBackoff(5000)
  })
}
```

A backoff generator is a function that returns the next delay to wait in milliseconds. For example, the full `constantBackoff(ms)` generator is below:

```js
function constantBackoff (ms) {
  ms = ms || 5000
  return (attempt) => ms
}
```

`recaller` comes with 5 backoff generator functions, inspired by [AWS's exponential backoff blog post](https://www.awsarchitectureblog.com/2015/03/backoff.html).

- [`constantBackoff(ms)`](https://github.com/SEAPUNK/recaller/blob/56f9d7b29a0459e1c4f4d40b1de9cd53be589405/lib/index.js#L86-L97)
- [`exponentialBackoff({base, cap, factor})`](https://github.com/SEAPUNK/recaller/blob/56f9d7b29a0459e1c4f4d40b1de9cd53be589405/lib/index.js#L99-L123)
- [`fullJitterBackoff({base, cap, factor})`](https://github.com/SEAPUNK/recaller/blob/56f9d7b29a0459e1c4f4d40b1de9cd53be589405/lib/index.js#L125-L136)
- [`equalJitterBackoff({base, cap, factor})`](https://github.com/SEAPUNK/recaller/blob/56f9d7b29a0459e1c4f4d40b1de9cd53be589405/lib/index.js#L138-L153)
- [`decorrelatedJitterBackoff({base, cap, times})`](https://github.com/SEAPUNK/recaller/blob/56f9d7b29a0459e1c4f4d40b1de9cd53be589405/lib/index.js#L154-L178)

handling retries
---

You can intercept each retry attempt, by providing a middleware function in `opts.onretry`.

```js
import recaller from 'recaller'

export default function doSomething () {
  return await recaller(async () => {
    const res = await fetch('https://google.com')
  }, {
    onretry: function (err, attempt, delayTime) {
      // Prevent retries; reject the recaller with the last error
      if (err instanceof TypeError) throw err

      // err is the error of the attempt
      // attempt is the attempt #. If the first call failed, then attempt = 1.
      // delayTime is how long we will wait before next attempt.

      logger.warn(`doSomething attempt ${attempt} failed;
        will wait ${delayTime} ms before trying again.
        error: ${err.stack}
      `)
    }
  })
}
```
