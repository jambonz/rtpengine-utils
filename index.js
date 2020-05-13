const assert = require('assert');
const Client = require('rtpengine-client').Client ;
const debug = require('debug')('jambonz:rtpengines-utils');
const Emitter = require('events');
const noopLogger = {info: () => {}, error: () => {}};
let idx = 0;
const selectClient = (engines) => {
  const active = engines.filter((c) => c.active);
  if (active.length) return active[idx++ % active.length];
};

function testEngines(logger, engines, opts) {
  debug('starting rtpengine pings');
  return setInterval(async() => {
    for (const engine of engines) {
      try {
        const res = await engine.list({limit: 32});
        if ('ok' === res.result) {
          engine.calls = res.calls.length;
          engine.active = true;
          debug(`length of response packet for ${engine.calls} calls: ${JSON.stringify(res).length}`);
          if (opts.emitter && opts.emitter instanceof Emitter) {
            opts.emitter.emit('resourceCount', {
              host: engine.host,
              hostType: 'sbc',
              resource: 'media.calls',
              count: engine.calls
            });
          }
          continue;
        }
        logger.debug({rtpengine: engine.host, response: res}, 'Failure response from rtpengine');
        engine.active = false;
      } catch (err) {
        logger.info({rtpengine: engine.host, err}, 'Failure response from rtpengine');
      }
      engine.active = false;
    }
  }, opts.pingInterval || 5000);
}

/**
 * function that returns an object containing a function --
 * that returned function (getRtpEngine) can be called repeatedly
 * to get a set of bound functions (offer, answer, del) that
 * are associated with the rtpengine having fewest calls
 *
 * {Array} arr - an array of host:port of rtpengines and their ng control ports
 * {object} logger - pino logger
 * {object} [opts] - configuration options
 * {number} [opts.timeout] - length of time in secs to wait for rtpengine to respond to a command
 * {number} [opts.pingInterval] - length of time in secs to ping rtpengines with a 'list' command
 */
module.exports = function(arr, logger, opts) {
  assert.ok(Array.isArray(arr) && arr.length, 'jambonz-rtpengine-utils: missing array of host:port rtpengines');
  opts = opts || {};
  logger = logger || noopLogger;

  const client = new Client({timeout: opts.timeout || 2500});

  const engines = arr
    .map((hp) => {
      const arr = /^(.*):(.*)$/.exec(hp.trim());
      if (!arr) throw new Error('rtpengine-utils: must provide an array of host:port rtpengines');
      const engine = {
        active: true,
        calls: 0,
        host: arr[1],
        port: parseInt(arr[2])
      };
      [
        'offer',
        'answer',
        'delete',
        'list',
        'startRecording',
        'stopRecording'
      ].forEach((method) => engine[method] = client[method].bind(client, engine.port, engine.host));
      return engine;
    });
  assert.ok(engines.length > 0, 'rtpengine-utils: must provide an array of host:port rtpengines');
  logger.info({engines}, 'jambonz-rtpengine-utils: rtpengine list');

  testEngines(logger, engines, opts);

  function getRtpEngine() {
    debug(`selecting rtpengine from array of ${engines.length}`);
    const engine = selectClient(engines);
    if (engine) {
      debug({engine}, 'selected engine');
      return {
        offer: engine.offer,
        answer: engine.answer,
        del: engine.delete
      };
    }
  }

  return {
    client,
    getRtpEngine
  };
};
